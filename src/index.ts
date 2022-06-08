require('dotenv').config();
import puppeteer from 'puppeteer';
import {restoreCookies, saveCookies} from './cookies';
import express from "express";
import axios from 'axios';

const app = express();

async function openMicrosoftWindow(base: puppeteer.Page, url: string) {
    if (process.env.NO_WINDOW == "1")
        throw new Error("No window mode enabled");
    const browser = await puppeteer.launch({
        executablePath: process.env.BROWSER_BINARY_PATH != "" ? process.env.BROWSER_BINARY_PATH : undefined,
        product: process.env.BROWSER_TYPE as "chrome" | "firefox",
        headless: false,
        args: ["--app=https://intra.epitech.eu/", "--window-size=1280,720"],
        defaultViewport: {width: 1280, height: 720}
    });
    const pages = await browser.pages();
    const page = pages[0];
    await saveCookies(base, "./cookies.json");
    await restoreCookies(page, "./cookies.json");
    await page.goto(url);
    await page.waitForRequest((res) => res.url().startsWith("https://intra.epitech.eu/"), { timeout: 0 });
    await saveCookies(page, "./cookies.json");
    await restoreCookies(base, "./cookies.json");
    await browser.close();
}

async function refreshIntranetToken() {
    const loginBtnSelector = '[href^="https://login.microsoftonline.com/common/oauth2/authorize"]';
    const browser = await puppeteer.launch({
        executablePath: process.env.BROWSER_BINARY_PATH != "" ? process.env.BROWSER_BINARY_PATH : undefined,
        product: process.env.BROWSER_TYPE as "chrome" | "firefox",
        args: process.env.BROWSER_ARGS?.split(" ") ?? [],
        headless: true
    });
    const page = await browser.newPage();
    try {
        await restoreCookies(page, "./cookies.json");
        await page.goto("https://intra.epitech.eu/");
        const loginButton = await page.$(loginBtnSelector);
        if (loginButton != null) {
            await page.click(loginBtnSelector);
            await new Promise((resolve) => setTimeout(resolve, 200));
            await page.waitForNetworkIdle();
            const url = page.mainFrame().url();
            if (url.startsWith("https://login.microsoftonline.com/")) {
                console.log("Asking for oauth...");
                await openMicrosoftWindow(page, url);
                await page.reload();
                await page.waitForNetworkIdle();
                await saveCookies(page, "./cookies.json");
            } else {
                console.log("Auto-auth was successful");
            }
        } else {
            console.log("Already logged in");
        }
    } catch (ex) {
        await page.goto("https://intra.epitech.eu/");
        const loginButton = await page.$(loginBtnSelector);
        if (loginButton != null) {
            await browser.close();
            throw ex;
        }
    }
    const token = (await page.cookies()).find(c => c.name == "user")?.value;
    await browser.close();
    if (typeof token !== "string")
        throw new Error("token not found");
    return token;
}

async function executeIntranetRequest(req: express.Request, token: string) {
    return await axios({
        baseURL: "https://intra.epitech.eu/",
        url: req.path,
        params: req.params,
        headers: {
            Origin: "intra.epitech.eu",
            Cookie: "user=" + token
        }
    }).catch(e => e.response);
}

(async () => {
    let intranetToken = await refreshIntranetToken();

    app.get("/", (req, res) => {
        res.send("the relay is working :D");
    });

    app.use("/intranet", async (req, res) => {
        try {
            let content = await executeIntranetRequest(req, intranetToken);
            if (content.status == 401 || content.status == 403) {
                intranetToken = await refreshIntranetToken();
                content = await executeIntranetRequest(req, intranetToken);
            }
            res.status(content.status).send(content.data);
        } catch (ex) {
            console.error(ex);
            res.status(500).send("Relay error.");
        }
    })

    const port = parseInt(process.env.PORT ?? "8080");
    const host = process.env.HOST ?? "127.0.0.1";

    app.listen(port, host, () => {
        console.log("Relay server started at http://" + host + ":" + port);
    });
})();
