const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { startLocalGameServer } = require("./local-server.cjs");

async function assertResponse(url, expectedStatus = 200, options = {}) {
  const response = await fetch(url, options);
  assert.equal(response.status, expectedStatus, `${url} returned ${response.status}`);
  return response;
}

function assertInlineScriptsParse(html, filename) {
  const scriptPattern = /<script(?![^>]*\btype=["'](?:importmap|module)["'])[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    if (match[1].trim()) {
      new vm.Script(match[1], { filename });
    }
  }
}

async function run() {
  const repositoryDir = path.resolve(__dirname, "..");
  const publicDir = path.join(repositoryDir, "public");
  const threeDir = path.join(__dirname, "node_modules", "three");
  assert.ok(fs.existsSync(path.join(publicDir, "index.html")), "public/index.html is missing");
  assert.ok(fs.existsSync(path.join(threeDir, "build", "three.module.js")), "Three.js is missing");

  const runtime = await startLocalGameServer({ publicDir, threeDir });
  try {
    const homeResponse = await assertResponse(`${runtime.origin}/?desktop=1`);
    const homeHtml = await homeResponse.text();
    assert.match(homeHtml, /\/vendor\/three\/build\/three\.module\.js/);
    assert.doesNotMatch(homeHtml, /https?:\/\/(?:cdn\.jsdelivr|www\.imgbly|files\.imagetourl|images\.weserv|cdn\.corenexis)/);
    assertInlineScriptsParse(homeHtml, "public/index.html");

    const storyResponse = await assertResponse(`${runtime.origin}/storyline.html?desktop=1`);
    const storyHtml = await storyResponse.text();
    assert.doesNotMatch(storyHtml, /https?:\/\//);
    assertInlineScriptsParse(storyHtml, "public/storyline.html");

    await assertResponse(`${runtime.origin}/vendor/three/build/three.module.js`);
    await assertResponse(`${runtime.origin}/vendor/three/examples/jsm/loaders/GLTFLoader.js`);
    await assertResponse(`${runtime.origin}/assets/offline-loading-bg.svg`);
    await assertResponse(`${runtime.origin}/assets/nevada-sand.svg`);
    await assertResponse(`${runtime.origin}/assets/pond-water.svg`);
    await assertResponse(`${runtime.origin}/assets/repair-kit.svg`);
    await assertResponse(`${runtime.origin}/assets/track-tread.svg`);
    await assertResponse(`${runtime.origin}/audio/engine_loop.ogg`, 200, { method: "HEAD" });

    const modelResponse = await assertResponse(
      `${runtime.origin}/assets/M3_Stuart_Early_HighPoly.glb`,
      206,
      { headers: { Range: "bytes=0-63" } }
    );
    assert.equal((await modelResponse.arrayBuffer()).byteLength, 64);
    assert.equal(modelResponse.headers.get("accept-ranges"), "bytes");

    await assertResponse(`${runtime.origin}/..%2f..%2fdesktop/package.json`, 403);
    console.log("Offline runtime checks passed.");
  } finally {
    await runtime.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
