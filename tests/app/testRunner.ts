﻿/* tslint:disable:prefer-template */
import { exit } from "nativescript-exit";
import * as platform from "tns-core-modules/platform";
import * as trace from "tns-core-modules/trace";
import { messageType } from "tns-core-modules/trace";
import { Button } from "tns-core-modules/ui/button";
import { Frame, topmost } from "tns-core-modules/ui/frame";
import { StackLayout } from "tns-core-modules/ui/layouts/stack-layout";
import { Page } from "tns-core-modules/ui/page";
import { TextView } from "tns-core-modules/ui/text-view";
import { ios } from "tns-core-modules/utils/utils";

import * as TKUnit from "./TKUnit";
import "./ui-test";

// When debugging
// trace.setCategories(trace.categories.concat(
//    trace.categories.Test,
//    trace.categories.Navigation,
//    trace.categories.Transition,
//    trace.categories.NativeLifecycle,
//    trace.categories.ViewHierarchy,
//    trace.categories.VisualTreeEvents
// ));

const env = require("./environment.json");

const traceCategories = [trace.categories.Test, trace.categories.Error];

if (!env.ci) {
    traceCategories.push("NOTA");
}

trace.enable();
trace.addCategories(traceCategories.join(","));

Frame.defaultAnimatedNavigation = false;

export function isRunningOnEmulator(): boolean {
    // This checks are not good enough to be added to modules but keeps unittests green.

    if (platform.device.os === platform.platformNames.android) {
        return (
            android.os.Build.FINGERPRINT.indexOf("generic") > -1 ||
            android.os.Build.HARDWARE.toLowerCase() === "goldfish" ||
            android.os.Build.HARDWARE.toLowerCase() === "donatello" || // VS Emulator
            android.os.Build.PRODUCT.toLocaleLowerCase().indexOf("sdk") > -1 ||
            android.os.Build.PRODUCT.toLocaleLowerCase().indexOf("emulator") > -1
        ); // VS Emulator
    } else if (platform.device.os === platform.platformNames.ios) {
        // return platform.device.model === "iPhone Simulator";
        return __dirname.search("Simulator") > -1;
    } else {
        throw new Error("Unsupported platform");
    }
}

export const allTests = {};

import * as webViewSafeAreaTests from "./ui/web-view/web-view-safe-area-tests";
import * as webViewTests from "./ui/web-view/web-view-tests";

if (platform.isIOS && ios.MajorVersion > 10) {
    allTests["SAFEAREA-WEBVIEW"] = webViewSafeAreaTests;
}

allTests["WEB-VIEW"] = webViewTests;

const testsSuitesWithLongDelay = {
    HTTP: 15 * 1000,
};

const testsWithLongDelay = {
    testLocation: 10000,
    testLocationOnce: 10000,
    testLocationOnceMaximumAge: 10000,
    // web-view-tests
    testLoadExistingUrl: 10000 * 5,
    testLoadLocalFile: 10000 * 5,
    testLoadInvalidUrl: 10000,
    testLoadUpperCaseSrc: 10000 * 5,
};

let startTime;
let running = false;
let testsQueue = new Array<TestInfo>();

function printRunTestStats() {
    let failedTestCount = 0;
    const failedTestInfo = [];
    const slowTests = new Array<string>();

    let allTests = testsQueue.filter((t) => t.isTest);

    allTests.forEach((testCase, i, arr) => {
        const testName = testCase.testName;
        if (!testCase.isPassed) {
            failedTestCount++;
            const stack = testCase.stack;
            const webStack = testCase.webStack;

            let message = [`${testName} FAILED: ${testCase.errorMessage}. `];
            if (stack) {
                message.push(`Stack ${stack}`);
            }
            if (webStack) {
                message.push(`WebStack ${webStack}`);
            }
            failedTestInfo.push(message.join(" "));
        }

        const duration = (testCase.duration / 1000).toFixed(2);
        if (testCase.duration > 500) {
            slowTests.push(`${testName}: ${duration}s`);
        }
    });

    const totalTime = (TKUnit.time() - startTime).toFixed(2);

    const finalMessage = [
        `=== ALL TESTS COMPLETE ===`,
        `${allTests.length - failedTestCount} OK, ${failedTestCount} failed`,
        `DURATION: ${totalTime} ms`,
        `=== END OF TESTS ===`,
    ];

    TKUnit.write(finalMessage, messageType.info);

    failedTestInfo.forEach((message, i, arr) => {
        TKUnit.write(message, messageType.error);
        finalMessage.push(message);
    });

    // console.log("test-result.xml:\n" + generateTestFile(allTests));

    // DO NOT CHANGE THE FIRST ROW! Used as an indicator for test run pass detection.
    TKUnit.write(`Tests EOF!`, messageType.info);

    if (env.ci) {
        setTimeout(exit(), 100);
    } else {
        showReportPage(finalMessage.join(`\n`));
    }
}

function showReportPage(finalMessage: string) {
    topmost().navigate({
        create: () => {
            const stack = new StackLayout();
            const btn = new Button();
            btn.text = "Rerun tests";
            btn.on("tap", () => runAll(testsSelector));
            stack.addChild(btn);

            const messageContainer = new TextView();
            messageContainer.editable = messageContainer.autocorrect = false;
            messageContainer.text = finalMessage;
            stack.addChild(messageContainer);

            const page = new Page();
            page.content = stack;
            messageContainer.focus();
            page.style.fontSize = 11;
            if (platform.isAndroid) {
                page.on("navigatedTo", () => {
                    messageContainer.focus();
                    setTimeout(() => messageContainer.dismissSoftInput());
                });
            }

            return page;
        },
        clearHistory: true,
    });
}

function startLog(): void {
    let testsName: string = this.name;
    TKUnit.write("START " + testsName + " TESTS.", messageType.info);
    this.start = TKUnit.time();
}

function log(): void {
    let testsName: string = this.name;
    let duration = TKUnit.time() - this.start;
    TKUnit.write(testsName + " COMPLETED for " + duration.toFixed(2) + " BACKSTACK DEPTH: " + topmost().backStack.length, messageType.info);
}

let testsSelector: string;
export function runAll(testSelector?: string) {
    testsSelector = testSelector;
    if (running) {
        // TODO: We may schedule pending run requests
        return;
    }

    let singleModuleName, singleTestName;
    if (testSelector) {
        const pair = testSelector.split(".");
        singleModuleName = pair[0];
        if (singleModuleName) {
            if (singleModuleName.length === 0) {
                singleModuleName = undefined;
            } else {
                singleModuleName = singleModuleName.toLowerCase();
            }
        }

        singleTestName = pair[1];
        if (singleTestName) {
            if (singleTestName.length === 0) {
                singleTestName = undefined;
            } else {
                singleTestName = singleTestName.toLowerCase();
            }
        }
    }

    TKUnit.write(`TESTS: ${singleModuleName || ""} ${singleTestName || ""}`);

    testsQueue.push(
        new TestInfo(() => {
            running = true;
            startTime = TKUnit.time();
        }),
    );

    for (const name in allTests) {
        if (singleModuleName && singleModuleName !== name.toLowerCase()) {
            continue;
        }

        const testModule = allTests[name];

        const test = testModule.createTestCase ? testModule.createTestCase() : testModule;
        test.name = name;

        testsQueue.push(new TestInfo(startLog, test));

        if (test.setUpModule) {
            testsQueue.push(new TestInfo(test.setUpModule, test));
        }

        for (const testName in test) {
            if (singleTestName && singleTestName !== testName.toLowerCase()) {
                continue;
            }

            const testFunction = test[testName];
            if (typeof testFunction === "function" && testName.substring(0, 4) === "test") {
                if (test.setUp) {
                    testsQueue.push(new TestInfo(test.setUp, test));
                }
                const testTimeout = testsWithLongDelay[testName] || testsSuitesWithLongDelay[name];
                testsQueue.push(new TestInfo(testFunction, test, true, name + "." + testName, false, null, testTimeout));
                if (test.tearDown) {
                    testsQueue.push(new TestInfo(test.tearDown, test));
                }
            }
        }
        if (test.tearDownModule) {
            testsQueue.push(new TestInfo(test.tearDownModule, test));
        }
        testsQueue.push(new TestInfo(log, test));
    }

    testsQueue.push(new TestInfo(printRunTestStats));
    testsQueue.push(
        new TestInfo(function() {
            testsQueue = [];
            running = false;
        }),
    );

    TKUnit.runTests(testsQueue, 0);
}

class TestInfo implements TKUnit.TestInfoEntry {
    testFunc: () => void;
    instance: any;
    isTest: boolean;
    testName: string;
    isPassed: boolean;
    testTimeout: number;
    duration: number;
    error?: TKUnit.WebViewError;

    get errorMessage() {
        return (this.error && this.error.message) || "";
    }

    get stack() {
        return this.error && this.error.stack;
    }

    get webStack() {
        return this.error && this.error.webStack;
    }

    constructor(testFunc, testInstance?: any, isTest?, testName?, isPassed?, error?, testTimeout?, duration?) {
        this.testFunc = testFunc;
        this.instance = testInstance || null;
        this.isTest = isTest || false;
        this.testName = testName || "";
        this.isPassed = isPassed || false;
        this.error = error;
        this.testTimeout = testTimeout;
        this.duration = duration;
    }
}
