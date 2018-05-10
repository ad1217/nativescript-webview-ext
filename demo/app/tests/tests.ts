import { WebViewExt } from '@nota/nativescript-webview-ext';
import * as fs from 'tns-core-modules/file-system';
import { isAndroid } from 'tns-core-modules/platform';
import * as trace from 'tns-core-modules/trace';
import * as frame from 'tns-core-modules/ui/frame';
import { PercentLength } from 'tns-core-modules/ui/frame';
import { GridLayout, ItemSpec } from "tns-core-modules/ui/layouts/grid-layout";
import * as URL from 'url';

trace.setCategories('NOTA');
trace.enable();

function resolveSrc(src: string) {
    if (src.startsWith('~/')) {
        src = `file://${fs.knownFolders.currentApp().path}/${src.substr(2)}`;
    } else if (src.startsWith("/")) {
        src = "file://" + src;
    }

    return src;
}

function timeoutPromise(delay = 100) {
    return new Promise((resolve) => setTimeout(resolve, delay));
}

describe("WebViewExt", function () {
    let webView: WebViewExt;

    const emptyHTMLFile = '~/assets/test-data/html/empty.html';
    const javascriptCallsFile = '~/assets/test-data/html/javascript-calls.html';
    const javascriptCallsXLocalFile = '~/assets/test-data/html/javascript-calls-x-local.html';
    const cssNotPredefinedFile = '~/assets/test-data/html/css-not-predefined.html';
    const cssPreDefinedlinkFile = '~/assets/test-data/html/css-predefined-link-tags.html';

    const localStyleSheetCssNAME = 'local-stylesheet.css';
    const localStyleSheetCssFile = '~/assets/test-data/css/local-stylesheet.css';

    const localJavaScriptName = 'local-javascript.js';
    const localJavaScriptFile = '~/assets/test-data/js/local-javascript.js';

    function loadWebSite(src: string) {
        return new Promise((resolve, reject) => {
            const load = (args) => {
                webView.off(WebViewExt.loadFinishedEvent, load);

                for (const key of Object.keys(args)) {
                    console.log(`${key} => ${args[key]}`);
                }

                if (args.error) {
                    reject(new Error(args.error));
                    return;
                }

                const loadedSrc = URL.parse(args.url, true).href;
                const expectedSrc = URL.parse(resolveSrc(src), true).href;
                expect(loadedSrc).toEqual(expectedSrc);
                resolve();
            };

            webView.on(WebViewExt.loadFinishedEvent, load);
            webView.src = src;
        });
    }

    beforeEach(() => {
        const page = frame.topmost().currentPage;

        const grid = new GridLayout();
        grid.height = PercentLength.parse('100%');
        page.content = grid;

        grid.addRow(new ItemSpec(0, 'star'));
        grid.addColumn(new ItemSpec(0, 'star'));

        webView = new WebViewExt();
        webView.row = 0;
        webView.col = 0;
        grid.addChild(webView);
    });

    describe('load files', () => {
        it("local file via ~/", (done) => {
            const src = emptyHTMLFile;

            loadWebSite(src)
                .then(() => {
                    expect(URL.parse(webView.src, true).href).toBe(URL.parse(src, true).href);
                    done();
                })
                .catch((err) => console.log(err));
        });

        it(('local file via x-local'), (done) => {
            const src = 'x-local://empty.html';
            webView.registerLocalResource('empty.html', emptyHTMLFile);

            loadWebSite(src)
                .then(() => {
                    expect(webView.src).toBe(src);
                    done();
                })
                .catch((err) => console.log(err));
        });
    });

    describe('inject files', () => {
        describe('stylesheets', () => {
            const testForRedScript = `
        (function() {
            var style = window.getComputedStyle(document.getElementsByClassName("red")[0]);
            var result = {};

            Object.keys(style)
                .filter(function(key) {
                    return isNaN(key);
                })
                .forEach(function(key) {
                    result[key] = style[key];
                });

            return result;
        })();
        `;

            const expectedRedColor = 'rgb(0, 128, 0)';

            it('Loaded predefined stylesheet', (done) => {
                const src = cssPreDefinedlinkFile;
                webView.registerLocalResource(localStyleSheetCssNAME, localStyleSheetCssFile);

                loadWebSite(src)
                    .then(() => timeoutPromise())
                    .then(() => webView.executeJavaScript(testForRedScript, false))
                    .then((style: any) => {
                        expect(style).toBeDefined();
                        expect(style.color).toBeDefined();
                        expect(style.color).toBe(expectedRedColor);

                        done();
                    })
                    .catch((err) => console.log(err));
            });

            it('Inject via x-local once', (done) => {
                const src = cssNotPredefinedFile;
                loadWebSite(src)
                    .then(() => webView.loadStyleSheetFile(localStyleSheetCssNAME, localStyleSheetCssFile))
                    .then(() => timeoutPromise())
                    .then(() => webView.executeJavaScript(testForRedScript, false))
                    .then((style: any) => {
                        expect(style).toBeDefined();
                        expect(style.color).toBeDefined();
                        expect(style.color).toBe(expectedRedColor);

                        done();
                    })
                    .catch((err) => console.log(err));
            });
        });

        describe('JavaScript', () => {
            it('once', (done) => {
                loadWebSite(javascriptCallsXLocalFile)
                    .then(() => webView.loadJavaScriptFile(localJavaScriptName, localJavaScriptFile))
                    .then(() => timeoutPromise())
                    .then(() => webView.executeJavaScript(`getNumber()`))
                    .then((result) => expect(result).toEqual(42))
                    .then(done)
                    .catch((err) => console.log(err));
            });

            it('auto load', (done) => {
                webView.autoLoadJavaScriptFile(localJavaScriptName, localJavaScriptFile);

                loadWebSite(javascriptCallsXLocalFile)
                    .then(() => timeoutPromise())
                    .then(() => webView.executeJavaScript(`getNumber()`))
                    .then((result) => expect(result).toEqual(42))
                    .then(() => loadWebSite(emptyHTMLFile))
                    .then(() => timeoutPromise())
                    .then(() => webView.executeJavaScript(`getNumber()`))
                    .then((result) => expect(result).toEqual(42))
                    .then(done)
                    .catch((err) => console.log(err));
            });
        });
    });

    describe('JavaScript interface', () => {
        const src = javascriptCallsFile;
        beforeEach((done) => {
            loadWebSite(src)
                .then(() => timeoutPromise())
                .then(done)
                .catch((err) => console.log(err));
        });

        it('events', (done) => {
            webView.executeJavaScript(`setupEventListener()`)
                .then(() => {
                    return new Promise((resolve) => {
                        const expected = {
                            huba: 'hop',
                        };

                        webView.on('web-message', (args: any) => {
                            const data = args.data;
                            expect(expected).toEqual(data);
                            webView.off('web-message');
                            resolve();
                        });

                        webView.emitToWebView('tns-message', expected);
                    });
                })
                .then(done)
                .catch((err) => console.log(err));
        });

        it('getNumber() - The answer to the ultimate question of life, the universe and everything', (done) => {
            webView.executeJavaScript(`getNumber()`)
                .then((result) => expect(result).toEqual(42))
                .then(done)
                .catch((err) => console.log(err));
        });

        it('Get pi', (done) => {
            webView.executeJavaScript(`getNumberFloat()`)
                .then((result) => expect(result).toEqual(3.14))
                .then(done)
                .catch((err) => console.log(err));
        });

        it('Get boolean - true', (done) => {
            webView.executeJavaScript(`getTruth()`)
                .then((result) => expect(result).toEqual(true))
                .then(done)
                .catch((err) => console.log(err));
        });

        it('Get boolean - false', (done) => {
            webView.executeJavaScript(`getFalse()`)
                .then((result) => expect(result).toEqual(false))
                .then(done)
                .catch((err) => console.log(err));
        });

        it('getString()', (done) => {
            webView.executeJavaScript(`getString()`)
                .then((result) => expect(result).toEqual(('string result from webview JS function')))
                .then(done)
                .catch((err) => console.log(err));
        });

        it('getArray()', (done) => {
            webView.executeJavaScript(`getArray()`)
                .then((result) => expect(result).toEqual([1.5, true, "hello"]))
                .then(done)
                .catch((err) => console.log(err));
        });

        it('getObject()', (done) => {
            webView.executeJavaScript(`getObject()`)
                .then((result) => expect(result).toEqual({ prop: "test", name: "object-test", values: [42, 3.14] }))
                .then(done)
                .catch((err) => console.log(err));
        });

        it('testPromiseResolve()', (done) => {
            webView.executePromise(`testPromiseResolve()`)
                .then((result) => expect(result).toEqual(42))
                .then(done)
                .catch((err) => console.log(err));
        });

        it('testPromiseReject()', (done) => {
            webView.executePromise(`testPromiseReject()`)
                .catch((err) => {
                    expect(err).toBeDefined();
                    expect(err.message).toBeDefined();
                    expect(err.message).toEqual('The Cake is a Lie');
                    done();
                    return Promise.reject(err);
                })
                .then(() => {
                    throw new Error(`Shouldn't resolve`);
                });
        });
    });

    afterEach(() => {
        const parent = webView && webView.parent as GridLayout;
        if (parent) {
            parent.removeChild(webView);
        }

        webView = null;
    });
});