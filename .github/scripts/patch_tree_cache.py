"""Speed up PoB's passive tree drawing in the web build.

PoB recomputes and redraws every connector and node of the passive tree on every frame. Desktop
PoB runs on LuaJIT and keeps up; the web build uses the plain Lua 5.2 interpreter, where this
takes most of each frame. This patch records the draw calls of the connector and node passes and
replays them while nothing that affects them has changed; a pure pan replays them shifted.

Usage: patch_tree_cache.py <root.zip | PassiveTreeView.lua>
If PoB's source no longer matches the anchors, the file is left unchanged and a warning printed,
so an upgrade never breaks the deploy.
"""
import os
import sys
import zipfile

MEMBER = "Classes/PassiveTreeView.lua"
MARK = "-- pob-web: draw cache"

HELPER = MARK + r"""
local drawCacheWrapped = { "DrawImage", "DrawImageQuad", "SetDrawColor", "SetDrawLayer", "DrawString" }
-- Index of the first x coordinate; how many coordinates follow as x,y pairs.
local drawCacheShift = { DrawImage = { 2, 1 }, DrawImageQuad = { 2, 4 }, DrawString = { 1, 1 } }
local function drawCacheReplay(self, key, sig, offsetX, offsetY)
	local cache = self.pobWebDrawCache and self.pobWebDrawCache[key]
	if not cache or cache.sig ~= sig then
		-- Record only once the same state shows up two frames in a row, so frames that change
		-- state (crossing nodes) do not pay for recording on top of the redraw.
		self.pobWebLastSig = self.pobWebLastSig or { }
		local stable = sig ~= nil and self.pobWebLastSig[key] == sig
		self.pobWebLastSig[key] = sig
		return false, stable
	end
	local dx, dy = offsetX - cache.x, offsetY - cache.y
	local ops = cache.ops
	for i = 1, #ops do
		local op = ops[i]
		local shift = op.shift
		if shift and (dx ~= 0 or dy ~= 0) then
			local p = shift[1]
			for _ = 1, shift[2] do
				op[p] = op[p] + dx
				op[p + 1] = op[p + 1] + dy
				p = p + 2
			end
		end
		op.fn(unpack(op, 1, op.n))
	end
	cache.x, cache.y = offsetX, offsetY
	return true
end
local function drawCacheBegin(sig)
	local ops = { }
	local saved = { }
	if sig == nil then
		-- Not cacheable this frame (tooltip, heat map, search...): draw directly, record nothing.
		return ops, saved
	end
	for _, name in ipairs(drawCacheWrapped) do
		local fn = _G[name]
		saved[name] = fn
		local shift = drawCacheShift[name]
		_G[name] = function(...)
			local op = { ... }
			op.n = select("#", ...)
			op.fn = fn
			op.shift = shift
			ops[#ops + 1] = op
			return fn(...)
		end
	end
	return ops, saved
end
local function drawCacheEnd(self, key, sig, offsetX, offsetY, ops, saved, ok)
	for name, fn in pairs(saved) do
		_G[name] = fn
	end
	self.pobWebDrawCache = self.pobWebDrawCache or { }
	-- Only keep the recording when every shifted argument is a number (no "CENTER" style anchors).
	if ok and sig then
		for _, op in ipairs(ops) do
			local shift = op.shift
			if shift then
				local p = shift[1]
				for _ = 1, shift[2] * 2 do
					if type(op[p]) ~= "number" then ok = false break end
					p = p + 1
				end
			end
			if not ok then break end
		end
	end
	self.pobWebDrawCache[key] = (ok and sig) and { sig = sig, x = offsetX, y = offsetY, ops = ops } or nil
end
local function drawCacheSig(...)
	local parts = { }
	for i = 1, select("#", ...) do
		parts[i] = tostring((select(i, ...)))
	end
	return table.concat(parts, "|")
end
"""

HEADER_ANCHOR = "local PassiveTreeViewClass = newClass(\"PassiveTreeView\")"

# Things that change what the connector pass draws (besides a pure pan).
BASE_SIG = ("scale, hoverNode, build.outputRevision, spec, spec.curAscendClassBaseName, self.compareSpec, "
            "self.compareSpec and self.compareSpec.allocNodes, self.traceMode, self.tracePath and #self.tracePath, "
            "build.spec and build.spec.allocMode, viewPort.width, viewPort.height")

CONN_START = "\t-- Draw the connecting lines between nodes\n\tSetDrawLayer(nil, 20)\n"
CONN_END = "\tif self.showHeatMap then\n\t\t-- Build the power numbers if needed\n"
NODE_START = "\t-- Draw the nodes\n\tfor nodeId, node in pairs(spec.nodes) do\n"
NODE_END = "\t-- Draw compare-only nodes"


def wrap(src: str, start: str, end: str, key: str, sig: str) -> str:
    a = src.index(start)
    b = src.index(end, a)
    body = src[a:b]
    pre = (
        f"\tlocal pobWebSig_{key} = {sig}\n"
        f"\tlocal pobWebHit_{key}, pobWebStable_{key} = drawCacheReplay(self, \"{key}\", pobWebSig_{key}, offsetX, offsetY)\n"
        f"\tif not pobWebHit_{key} then\n"
        f"\tif not pobWebStable_{key} then pobWebSig_{key} = nil end\n"
        f"\tlocal pobWebOps, pobWebSaved = drawCacheBegin(pobWebSig_{key})\n"
        f"\tlocal pobWebOk, pobWebErr = pcall(function()\n"
    )
    post = (
        f"\tend)\n"
        f"\tdrawCacheEnd(self, \"{key}\", pobWebSig_{key}, offsetX, offsetY, pobWebOps, pobWebSaved, pobWebOk)\n"
        f"\tif not pobWebOk then error(pobWebErr, 0) end\n"
        f"\tend\n"
    )
    return src[:a] + pre + body + post + src[b:]


def patch(src: str) -> str | None:
    if MARK in src:
        return None
    for anchor in (HEADER_ANCHOR, CONN_START, CONN_END, NODE_START, NODE_END):
        if src.count(anchor) != 1:
            print(f"patch_tree_cache: anchor not found once, skipping: {anchor[:50]!r}")
            return None
    sig = f"drawCacheSig({BASE_SIG})"
    # Node pass: also draws the hovered node's tooltip and search rings, so cache only without them.
    node_sig = (f"(not hoverNode and not self.showHeatMap and not launch.devModeAlt and self.searchStr == \"\" "
                f"and not IsKeyDown(\"SHIFT\") and not IsKeyDown(\"CTRL\")) and drawCacheSig({BASE_SIG}) or nil")
    src = wrap(src, NODE_START, NODE_END, "nodes", node_sig)
    src = wrap(src, CONN_START, CONN_END, "connectors", sig)
    return src.replace(HEADER_ANCHOR, HELPER + "\n" + HEADER_ANCHOR, 1)


def main() -> None:
    path = sys.argv[1]
    if path.endswith(".lua"):
        with open(path, encoding="utf-8", newline="") as f:
            out = patch(f.read())
        if out:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(out)
            print("patch_tree_cache: patched", path)
        return
    tmp = path + ".tmp"
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        done = False
        for info in zin.infolist():
            data = zin.read(info)
            if info.filename == MEMBER:
                out = patch(data.decode("utf-8"))
                if out:
                    data = out.encode("utf-8")
                    done = True
            zout.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED)
    os.replace(tmp, path)
    print("patch_tree_cache:", "patched" if done else "left unchanged", MEMBER)


if __name__ == "__main__":
    main()
