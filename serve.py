#!/usr/bin/env python3
"""No-cache static server for running Strange Flesh from source.

The game must be served over HTTP (opening index.html from disk fails: browsers
block its level/asset requests on file://). Caching is disabled so code edits
show up on a plain reload. Usage:

    python3 serve.py [--root DIR] [--port 8000]

Then open http://localhost:8000/index.html (or /editor.html for the editor).
"""
import argparse
import os
from http.server import SimpleHTTPRequestHandler, HTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass  # quiet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    os.chdir(args.root)
    print(f"Serving {args.root} on http://127.0.0.1:{args.port} (no-cache)")
    HTTPServer(("127.0.0.1", args.port), NoCacheHandler).serve_forever()


if __name__ == "__main__":
    main()
