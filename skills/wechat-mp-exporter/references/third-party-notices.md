# Third-party notices

The setup command fetches and modifies `wechat-article-exporter` from <https://github.com/wechat-article/wechat-article-exporter> at commit `6b67dfe64f6f359be604239e98f74c1021fc9d5f`.

The upstream project is licensed under the MIT License:

> MIT License
>
> Copyright (c) 2024 Jock
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

The bundled patch disables public proxy defaults, remote server-side JSON parsing, JSON content download, token logging, and Umami analytics. The wrapper itself is licensed under the MIT License in `LICENSE`.

Lite setup downloads hash-pinned Python packages from PyPI; no package or browser binary is bundled in this skill. Direct dependencies are Selenium 4.46.0 (Apache-2.0), Beautiful Soup 4.13.4 (MIT), and markdownify 1.1.0 (MIT). Their transitive versions and artifact hashes are recorded in `assets/lite-requirements.lock`; their upstream license files apply after installation. The lock was resolved for Python 3.12 from the PyPI simple index with `uv pip compile --generate-hashes`, with Python downloads and source builds disabled; the exact generator version, command, date, and direct pins are recorded in the lock header.
