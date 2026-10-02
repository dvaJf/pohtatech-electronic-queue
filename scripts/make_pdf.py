import os
import subprocess
import html
import re

md_path = "/home/vacuum/Desktop/tsifrovaya-ochered-novogo-pokoleniya/docs/DEVOPS_GUIDE_RU.md"
html_path = "/home/vacuum/Desktop/tsifrovaya-ochered-novogo-pokoleniya/docs/DEVOPS_GUIDE_RU.html"
pdf_path = "/home/vacuum/Desktop/tsifrovaya-ochered-novogo-pokoleniya/docs/DEVOPS_GUIDE_RU.pdf"

with open(md_path, "r", encoding="utf-8") as f:
    text = f.read()

def format_inline(value):
    """Small Markdown subset used by the handbook, after HTML escaping."""
    value = html.escape(value)
    value = re.sub(r'\[([^]]+)\]\(([^ )]+)\)', r'<a href="\2">\1</a>', value)
    value = re.sub(r'`([^`]+)`', r'<code>\1</code>', value)
    value = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', value)
    return value

# Simple markdown to HTML conversion for headers, codeblocks, tables, lists
lines = text.split("\n")
html_lines = []
in_code = False
in_table = False

for line in lines:
    if line.startswith("```"):
        if in_code:
            html_lines.append("</code></pre>")
            in_code = False
        else:
            lang = line[3:].strip()
            html_lines.append(f'<pre><code class="language-{lang}">')
            in_code = True
        continue
    
    if in_code:
        html_lines.append(html.escape(line))
        continue

    # Tables
    if "|" in line and "-|-" in line:
        continue # separator
    if line.strip().startswith("|") and line.strip().endswith("|"):
        cells = [c.strip() for c in line.strip()[1:-1].split("|")]
        if not in_table:
            html_lines.append("<table><thead><tr>" + "".join(f"<th>{format_inline(c)}</th>" for c in cells) + "</tr></thead><tbody>")
            in_table = True
        else:
            html_lines.append("<tr>" + "".join(f"<td>{format_inline(c)}</td>" for c in cells) + "</tr>")
        continue
    elif in_table:
        html_lines.append("</tbody></table>")
        in_table = False

    # Headers
    if line.startswith("# "):
        html_lines.append(f"<h1>{format_inline(line[2:])}</h1>")
    elif line.startswith("## "):
        html_lines.append(f"<h2>{format_inline(line[3:])}</h2>")
    elif line.startswith("### "):
        html_lines.append(f"<h3>{format_inline(line[4:])}</h3>")
    elif line.startswith("#### "):
        html_lines.append(f"<h4>{format_inline(line[5:])}</h4>")
    elif line.startswith("---"):
        html_lines.append("<hr/>")
    elif line.startswith("> "):
        html_lines.append(f"<blockquote>{format_inline(line[2:])}</blockquote>")
    elif line.startswith("- "):
        html_lines.append(f"<li>{format_inline(line[2:])}</li>")
    elif line.strip() == "":
        html_lines.append("<br/>")
    else:
        html_lines.append(f"<p>{format_inline(line)}</p>")

if in_table:
    html_lines.append("</tbody></table>")

body_content = "\n".join(html_lines)

full_html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>DevOps-путеводитель — Цифровая очередь</title>
<style>
  @page {{
    size: A4;
    margin: 20mm 15mm 20mm 15mm;
  }}
  body {{
    font-family: "Noto Sans", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #172033;
    line-height: 1.6;
    font-size: 13px;
    background: #fff;
  }}
  h1 {{
    color: #102a43;
    font-size: 26px;
    border-bottom: 3px solid #14b8a6;
    padding-bottom: 8px;
    margin-top: 0;
  }}
  h2 {{
    color: #075985;
    font-size: 18px;
    border-left: 4px solid #14b8a6;
    background: #f0fdfa;
    padding: 6px 0 6px 10px;
    margin-top: 24px;
    page-break-after: avoid;
  }}
  h3 {{
    color: #1d4ed8;
    font-size: 15px;
    margin-top: 18px;
    page-break-after: avoid;
  }}
  pre {{
    background: #102a43;
    color: #ecfeff;
    border-left: 4px solid #2dd4bf;
    border-radius: 6px;
    padding: 12px;
    font-family: "JetBrains Mono", Consolas, Monaco, monospace;
    font-size: 11px;
    overflow-x: auto;
    page-break-inside: avoid;
  }}
  code {{
    font-family: "JetBrains Mono", Consolas, Monaco, monospace;
    background: #ecfeff;
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 11.5px;
    color: #0f3d51;
  }}
  pre code {{
    background: transparent;
    color: inherit;
    padding: 0;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0;
    font-size: 12px;
    page-break-inside: avoid;
  }}
  th, td {{
    border: 1px solid #cbd5e1;
    padding: 8px 10px;
    text-align: left;
  }}
  th {{
    background-color: #0f766e;
    color: #fff;
    font-weight: 600;
  }}
  tr:nth-child(even) {{
    background-color: #f8fafc;
  }}
  hr {{
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 20px 0;
  }}
  li {{
    margin-bottom: 4px;
  }}
  blockquote {{
    margin: 12px 0;
    padding: 9px 12px;
    color: #155e75;
    background: #ecfeff;
    border-left: 4px solid #22c55e;
  }}
  a {{ color: #0369a1; text-decoration: none; }}
</style>
</head>
<body>
{body_content}
</body>
</html>
"""

with open(html_path, "w", encoding="utf-8") as f:
    f.write(full_html)

# Run chrome headless print to pdf
cmd = [
    "google-chrome",
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--no-pdf-header-footer",
    f"--print-to-pdf={pdf_path}",
    html_path
]
subprocess.run(cmd, check=True)
print(f"Successfully generated {pdf_path}")
