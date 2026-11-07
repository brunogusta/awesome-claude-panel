export const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#0d1117}
body{color:#c9d1d9;font:13px/1.45 Inter,"Segoe UI",system-ui,sans-serif;padding:14px 12px 16px;-webkit-font-smoothing:antialiased}
svg{display:block}
.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace}
.top{display:flex;align-items:center;gap:8px;padding:2px 4px 12px}
.proj{color:#e6edf3;font-weight:600;font-size:14px;letter-spacing:-.01em;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.branch{display:flex;align-items:center;gap:5px;color:#7d8590;font:12px "JetBrains Mono",ui-monospace,Menlo,monospace;background:#161b22;border:1px solid #30363d;border-radius:999px;padding:2px 9px 2px 7px;flex:none}
.branch .up{color:#3fb950}
.now{display:flex;gap:10px;align-items:flex-start;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:10px 12px;margin-bottom:12px}
.dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none}
.now .body{min-width:0;flex:1}
.kick{font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#7d8590}
.now .title{color:#e6edf3;font-weight:600;font-size:13.5px;margin-top:1px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.now .sub{color:#7d8590;font-size:12px;margin-top:1px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.now .legend{display:flex;gap:12px;margin-top:6px;font-size:11px}
.now .sub.mono{font-size:11.5px}
.bar{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.chip{display:inline-flex;align-items:center;gap:5px;background:#161b22;border:1px solid #30363d;color:#9da7b3;border-radius:6px;padding:3px 9px;font-size:12px;line-height:1.35}
.chip.on{background:#1f6feb26;border-color:#1f6feb99;color:#58a6ff}
.sec{display:flex;justify-content:space-between;align-items:center;margin:2px 4px 8px}
.pill{background:#1f6feb26;color:#58a6ff;border-radius:999px;padding:1px 9px;font-size:11px;letter-spacing:0;text-transform:none;font-weight:500}
.list{margin-bottom:12px}
.file{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px;border:1px solid transparent}
.file.on{background:#161b22;border-color:#30363d}
.ico{width:16px;height:16px;flex:none}
.ico svg{width:16px;height:16px}
.name{color:#e6edf3;font-weight:500;white-space:nowrap}
.dir{color:#7d8590;font-size:12px;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.file .name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.cnt{font:12px "JetBrains Mono",ui-monospace,Menlo,monospace;white-space:nowrap;flex:none}
.cnt .p{color:#3fb950}
.cnt .m{color:#f85149;margin-left:5px}
.size{color:#7d8590;font:11.5px "JetBrains Mono",ui-monospace,Menlo,monospace;flex:none}
.mark{width:3px;align-self:stretch;border-radius:2px;flex:none;margin:-3px 0}
.chev{width:12px;height:12px;flex:none;color:#7d8590}
.diff{margin:4px 0 8px;border:1px solid #30363d;border-radius:8px;overflow:hidden;background:#0d1117;font:12px/1.6 "JetBrains Mono",ui-monospace,Menlo,monospace}
.hunk{background:#161b22;color:#7d8590;padding:3px 10px;border-bottom:1px solid #21262d;border-top:1px solid #21262d;white-space:pre;overflow:hidden}
.hunk:first-child{border-top:0}
.ln{display:flex;overflow:hidden}
.ln .n{width:38px;text-align:right;padding-right:8px;color:#6e7681;flex:none;user-select:none}
.ln .s{width:14px;flex:none;color:#7d8590}
.ln code{font:inherit;white-space:pre;color:#c9d1d9}
.ln.a{background:#2ea04326}
.ln.a .n{background:#2ea0431a;color:#3fb950}
.ln.a .s{color:#3fb950}
.ln.d{background:#f8514926}
.ln.d .n{background:#f851491a;color:#f85149}
.ln.d .s{color:#f85149}
.more{color:#7d8590;font:12px Inter,"Segoe UI",system-ui,sans-serif;padding:5px 10px;border-top:1px solid #21262d;background:#161b22}
.acts{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.btn{display:inline-flex;align-items:center;gap:6px;background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:4px 10px;font-size:12px;line-height:1.35}
.btn.pri{background:#1f6feb;border-color:#388bfd;color:#fff;font-weight:500}
.tree{margin-top:4px;display:flex;align-items:center;gap:9px;color:#7d8590;padding:10px 12px;border:1px dashed #30363d;border-radius:10px;font-size:12px}
.tree .open{color:#58a6ff;margin-left:auto}
.empty{color:#7d8590;font-size:12px;padding:8px 9px}
.newdot{width:8px;height:8px;border-radius:50%;background:#e8914f;box-shadow:0 0 7px #e8914fb3;flex:none;margin-left:1px}
.livetag{flex:none;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-radius:999px;padding:1px 8px}
.livetag.e{color:#e8914f;background:#e8914f26}
.livetag.r{color:#ad8cf2;background:#ad8cf226}
.file.live-edit{background:#e8914f14;border-color:#e8914f80}
.file.live-read{background:#ad8cf20f;border-color:#ad8cf255}
.rest{color:#7d8590;font-size:12px;padding:6px 9px}
.chip[data-hot]{background:#2d333b;border-color:#6e7681;color:#e6edf3}
.chip.on[data-hot]{background:#1f6feb40;border-color:#58a6ff;color:#79c0ff}
.btn[data-hot]{background:#30363d;border-color:#8b949e;color:#fff}
.btn.pri[data-hot]{background:#388bfd;border-color:#79c0ff}
.file[data-hot]{background:#1c2128;border-color:#3d444d}
.file[data-hot] .name{color:#fff}
.pill[data-hot]{background:#1f6feb55;color:#79c0ff}
.tree[data-hot]{border-style:solid;border-color:#58a6ff88;color:#c9d1d9;background:#161b22}
`
