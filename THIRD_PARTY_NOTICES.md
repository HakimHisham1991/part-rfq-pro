# Third-Party Notices

This file attributes third-party software used by Part RFQ Pro / 3D Part Analyzer.

---

## Analysis Situs

The B-Rep hole feature recognition pipeline (`brep-feature-recognition.js`) is
**modeled on** the architecture of Analysis Situs — specifically its Attributed
Adjacency Graph (AAG) approach and drilled-hole recognition strategy
(`asiAlgo_AAG`, `asiAlgo_RecognizeDrilledHoles`, dihedral / vexity checking).

This project does **not** redistribute Analysis Situs source code. The
implementation here is an independent TypeScript/JavaScript port of the
algorithmic approach, running on `occt-wasm` in the browser.

Analysis Situs is licensed under the **BSD 3-Clause License**.

Copyright (c) Analysis Situs contributors.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Project: https://gitlab.com/ssv/AnalysisSitus  
Docs: https://analysissitus.org/

---

## occt-wasm

OpenCascade Technology compiled to WebAssembly with a TypeScript API.

License: MIT OR Apache-2.0  
https://github.com/andymai/occt-wasm

---

## occt-import-js

STEP/IGES mesh import via OpenCascade WASM (used for rendering tessellation).

License: see package upstream  
https://github.com/kovacsv/occt-import-js
