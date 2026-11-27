import { type Game, gameData } from "pob-game";
import { Driver } from "./driver.ts";

async function main(): Promise<void> {
  const testMode = import.meta.env.MODE === "test";
  const params = new URLSearchParams(window.location.search);
  const game = (testMode ? params.get("game") : null) ?? __RUN_GAME__;
  const version = (testMode ? params.get("version") : null) ?? __RUN_VERSION__;
  const poeOAuthExpiresIn = Number(params.get("poe-oauth-expires-in") ?? "2419200");
  const poeOAuthApiStatuses = (params.get("poe-oauth-api") ?? "200").split(",").map(Number);
  let poeOAuthRefreshCount = Number(params.get("poe-oauth-refresh-start") ?? "0");
  const poeOAuth: PoBTestState["poeOAuth"] = testMode && params.get("poe-oauth") === "mock"
    ? { authorizationRequests: [], fetchRequests: [], logoutCalls: 0 }
    : undefined;
  const testState: PoBTestState | undefined = testMode
    ? {
      started: false,
      frameCount: 0,
      renderStats: null,
      title: "",
      errors: [] as string[],
      pressedKeys: [],
      frameSamples: [],
      poeOAuth,
      resetFrameSamples() {
        this.frameSamples = [];
      },
    }
    : undefined;

  if (testState) window.__POB_TEST__ = testState;

  const versionPrefix = `${__ASSET_PREFIX__}/games/${game}/versions/${version}`;
  console.log("Loading driver with assets:", versionPrefix);

  const driver = new Driver(
    __RUN_BUILD__,
    versionPrefix,
    {
      onError: (error) => {
        testState?.errors.push(String(error));
        console.error(error);
      },
      onFrame: (_at, time, stats) => {
        if (testState) {
          testState.frameCount += 1;
          testState.frameSamples.push({
            totalTime: time,
            rendererTime: stats?.lastFrameTime ?? 0,
            glyphMisses: stats?.glyphAtlas.misses ?? 0,
            glyphUploadBytes: stats?.glyphAtlas.uploadedBytes ?? 0,
            instanceBytes: stats?.backend.instanceBytes ?? 0,
            instances: stats?.backend.instances ?? 0,
            dispatches: stats?.backend.dispatches ?? 0,
          });
          if (stats) testState.renderStats = stats;
        }
      },
      onFetch: async (url, headers, body) => {
        if (!poeOAuth) {
          const relayHosts = [
            "maxroll.gg",
            "pob.codes",
            "api.pob.codes",
            "pobb.in",
            "poe.ninja",
            "pastebin.com",
            "pastebinp.com",
            "rentry.co",
            "poedb.tw",
          ];
          let host = "";
          try {
            host = new URL(url).hostname.replace(/^www\./, "");
          } catch {
            // leave host empty; the direct fetch below reports the error
          }
          try {
            if (relayHosts.includes(host)) {
              const relay = await fetch(`${import.meta.env.BASE_URL}api/fetch`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url, headers, body }),
              });
              if (relay.ok || relay.status === 403) return await relay.json();
            }
            const response = await fetch(url, { method: body ? "POST" : "GET", headers, body });
            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
              responseHeaders[key] = value;
            });
            return { body: await response.text(), error: undefined, headers: responseHeaders, status: response.status };
          } catch (error) {
            return {
              body: "",
              error: error instanceof Error ? error.message : String(error),
              headers: {},
              status: undefined,
            };
          }
        }
        poeOAuth.fetchRequests.push({ url, headers, body });

        const endpoint = new URL(url);
        if (endpoint.origin === "https://www.pathofexile.com" && endpoint.pathname === "/oauth/token") {
          const grant = new URLSearchParams(body).get("grant_type");
          const accessToken = grant === "refresh_token"
            ? `mock-refreshed-token-${++poeOAuthRefreshCount}`
            : "mock-initial-token";
          return {
            body: JSON.stringify({
              access_token: accessToken,
              expires_in: poeOAuthExpiresIn,
              refresh_token: "mock-refresh-token",
              token_type: "bearer",
            }),
            error: undefined,
            headers: {},
            status: 200,
          };
        }
        if (endpoint.origin === "https://api.pathofexile.com" && endpoint.pathname.startsWith("/character")) {
          const characterRequests = poeOAuth.fetchRequests.filter((request) =>
            new URL(request.url).origin === "https://api.pathofexile.com"
          );
          const status = poeOAuthApiStatuses[characterRequests.length - 1] ?? 200;
          return {
            body: status === 200 ? JSON.stringify(game === "poe2" ? { characters: [] } : []) : "",
            error: undefined,
            headers: {},
            status,
          };
        }
        throw new Error(`Unexpected OAuth mock request: ${url}`);
      },
      onOAuthAuthorize: async (url, timeoutMs) => {
        if (!poeOAuth) throw new Error("OAuth authorization not implemented in shell");
        poeOAuth.authorizationRequests.push({ url, timeoutMs });
        const state = new URL(url).searchParams.get("state");
        if (!state) throw new Error("PoE OAuth test request did not contain state");
        if (poeOAuth.authorizationRequests.length === 1) {
          return { error: "The user denied access to your application", state, port: 0 };
        }
        if (poeOAuth.authorizationRequests.length === 2) {
          return { code: "mock-authorization-code", state: "mismatched-state", port: 0 };
        }
        return { code: "mock-authorization-code", state, port: 0 };
      },
      onOAuthLogout: () => {
        if (poeOAuth) poeOAuth.logoutCalls += 1;
      },
      onTitleChange: (title) => {
        if (testState) testState.title = title;
      },
    },
    {
      onKeyboardStateChange: (keys) => {
        if (testState) testState.pressedKeys = [...keys];
      },
    },
  );
  // Signed in (session cookie checked by the site middleware) → enable the Builds/Cloud folder.
  let cloudToken: string | undefined;
  if (!testMode) {
    try {
      const me = await fetch(`${import.meta.env.BASE_URL}api/me`, { cache: "no-store" });
      if (me.ok && (me.headers.get("content-type") ?? "").includes("json")) cloudToken = "session";
    } catch {
      cloudToken = undefined;
    }
  }
  await driver.start({
    userDirectory: gameData[game as Game].userDirectory,
    settingsRootElement: gameData[game as Game].settingsRootElement,
    cloudflareKvPrefix: `${import.meta.env.BASE_URL}api/kv`,
    cloudflareKvAccessToken: cloudToken,
    cloudflareKvUserNamespace: undefined,
  });
  const root = document.querySelector("#window") as HTMLElement;
  if (root) {
    await driver.attachToDOM(root);
  }
  (window as unknown as { __pobEval?: (chunk: string) => Promise<string> }).__pobEval = (chunk) =>
    driver.evalLua(chunk);
  if (testState) {
    testState.started = true;
    testState.loadBuildFromCode = (code) => driver.loadBuildFromCode(code);
    testState.getBuildCode = () => driver.getBuildCode();
    testState.flushInput = () => driver.flushInput();
  }
}

void main().catch((error) => {
  window.__POB_TEST__?.errors.push(String(error));
  console.error("Driver startup failed", error);
});
