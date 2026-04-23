export class LicensePage {
  constructor(app) {
    this.app = app
  }

  async render() {
    this.app.appContainer.innerHTML = `
            <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
                <div class="flex items-center justify-between mb-6">
                    <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                        <i class="fa-solid fa-chevron-left text-xl"></i>
                    </a>
                    <h1 class="text-xl font-bold text-wabi-primary">授權條款</h1>
                    <div class="w-6"></div>
                </div>
                
                <div class="bg-wabi-surface rounded-xl shadow-sm border border-wabi-border p-6 mb-8 text-wabi-text-primary space-y-4">
                    <h2 class="text-lg font-bold text-wabi-primary">專案名稱：輕鬆記帳 2.0</h2>
                    <p>版權所有 &copy; 2023-2025 ADT109119 (The walking fish 步行魚)</p>
                    <hr class="border-wabi-border my-4">
                    
                    <h3 class="text-md font-bold text-wabi-primary">原始碼授權 (MIT License)</h3>
                    <div class="bg-wabi-bg p-4 rounded-lg text-sm text-wabi-text-secondary font-mono overflow-auto border border-wabi-border">
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:<br><br>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.<br><br>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
                    </div>

                    <h3 class="text-md font-bold text-wabi-primary mt-6">圖示與圖像版權保留 (Exceptions to the MIT License)</h3>
                    <div class="bg-wabi-bg p-4 rounded-lg text-sm text-wabi-text-secondary border border-wabi-border">
                        上述 MIT License 僅適用於本軟體的原始碼。所有視覺資產（包含但不限於 icon 與 assets 目錄下的設計與圖形）皆<strong>不適用</strong> MIT License。<br><br>
                        作者嚴格保留上述視覺資產與圖示設計之版權。未經版權所有者明確的書面許可，不得複製、修改、散布或使用這些資產。
                    </div>

                    <hr class="border-wabi-border my-6">

                    <h2 class="text-lg font-bold text-wabi-primary mt-6 mb-4">第三方開源函式庫聲明</h2>
                    <ul class="space-y-4">
                        <li>
                            <strong class="text-wabi-text-primary">Tailwind CSS</strong> (MIT License)<br>
                            Copyright (c) Tailwind Labs, Inc.<br>
                            <a href="https://github.com/tailwindlabs/tailwindcss/blob/master/LICENSE" target="_blank" class="text-wabi-accent text-sm underline">License</a>
                        </li>
                        <li>
                            <strong class="text-wabi-text-primary">Font Awesome Free</strong> (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)<br>
                            Copyright (c) Fonticons, Inc.<br>
                            <a href="https://fontawesome.com/license/free" target="_blank" class="text-wabi-accent text-sm underline">License</a>
                        </li>
                        <li>
                            <strong class="text-wabi-text-primary">Chart.js</strong> (MIT License)<br>
                            Copyright (c) 2014-2022 Chart.js Contributors<br>
                            <a href="https://github.com/chartjs/Chart.js/blob/master/LICENSE.md" target="_blank" class="text-wabi-accent text-sm underline">License</a>
                        </li>
                        <li>
                            <strong class="text-wabi-text-primary">date-fns</strong> & <strong>chartjs-adapter-date-fns</strong> (MIT License)<br>
                            Copyright (c) 2021 Sasha Koss and Lesha Koss; Copyright (c) 2019 chartjs-adapter-date-fns Contributors<br>
                            <a href="https://github.com/date-fns/date-fns/blob/master/LICENSE.md" target="_blank" class="text-wabi-accent text-sm underline">License</a>
                        </li>
                        <li>
                            <strong class="text-wabi-text-primary">idb</strong> (ISC License)<br>
                            Copyright (c) 2016, Jake Archibald<br>
                            <a href="https://github.com/jakearchibald/idb/blob/main/LICENSE" target="_blank" class="text-wabi-accent text-sm underline">License</a>
                        </li>
                        <li>
                            <strong class="text-wabi-text-primary">Capacitor & Plugins</strong> (MIT License)<br>
                            Copyright (c) 2017-present Drifty Co.<br>
                            <a href="https://github.com/ionic-team/capacitor/blob/main/LICENSE" target="_blank" class="text-wabi-accent text-sm underline">License</a>
                        </li>
                        <li>
                            <strong class="text-wabi-text-primary">@codetrix-studio/capacitor-google-auth</strong> (MIT License)<br>
                            Copyright (c) 2021 Codetrix Studio<br>
                            <a href="https://github.com/CodetrixStudio/CapacitorGoogleAuth/blob/master/LICENSE" target="_blank" class="text-wabi-accent text-sm underline">License</a>
                        </li>
                        <li>
                            <strong class="text-wabi-text-primary">Google Identity Services API</strong><br>
                            Use of Google Identity Services is governed by <a href="https://developers.google.com/terms" target="_blank" class="text-wabi-accent text-sm underline">Google APIs Terms of Service</a>.
                        </li>
                    </ul>
                </div>
            </div>
        `
  }
}
