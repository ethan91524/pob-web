"""Print a Pages wrangler.toml with the KV binding, creating the KV namespace on first run.

Usage: cloudflare_config.py "<wrangler command>" <namespace title>
Reads GOOGLE_CLIENT_ID from the environment.
"""
import json
import os
import shlex
import subprocess
import sys

wrangler = shlex.split(sys.argv[1])
title = sys.argv[2]


def namespaces():
    out = subprocess.run(wrangler + ["kv", "namespace", "list"], capture_output=True, text=True, check=True).stdout
    start = out.index("[")
    return json.loads(out[start:])


def find(items):
    return next((n["id"] for n in items if n.get("title") == title), None)


ns_id = find(namespaces())
if not ns_id:
    subprocess.run(wrangler + ["kv", "namespace", "create", title], check=True, stdout=sys.stderr)
    ns_id = find(namespaces())
if not ns_id:
    sys.exit(f"could not create KV namespace {title}")

client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
print('name = "pob-web"')
print('pages_build_output_dir = "site-cf"')
print('compatibility_date = "2024-09-23"')
print()
print("[vars]")
print(f"GOOGLE_CLIENT_ID = {json.dumps(client_id)}")
print()
print("[[kv_namespaces]]")
print('binding = "KV"')
print(f"id = {json.dumps(ns_id)}")
