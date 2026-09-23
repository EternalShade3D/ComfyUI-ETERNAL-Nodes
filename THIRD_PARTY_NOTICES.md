# Third-party notices

This pack contains code ported from other projects. Original licences are
reproduced below and apply to the ported portions.

---

## Panorama 360 Viewer (`node_viewer360.py`, `js/panorama360_viewer.js`)

Ported from **pavel-zinchenko/comfyui-360-viewer**
(https://github.com/pavel-zinchenko/comfyui-360-viewer).

Changes made in this pack: node id namespaced to `EternalViewer360`, a
`frame_index` widget added, the temp-file write replaced by ComfyUI's own
`ui.PreviewImage` path, and the viewer JS hardened (pointer capture, renderer
disposal on rebuild, CDN failure reported on the node). The viewing maths is
unchanged.

```
MIT License

Copyright (c) 2026 pavel-zinchenko

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The viewer loads three.js (r128) from cdnjs.cloudflare.com at runtime; three.js
is MIT licensed and is not bundled in this repository.