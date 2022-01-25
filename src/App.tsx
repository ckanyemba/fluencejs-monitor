import React, { useEffect, useState } from "react";
import logo from "./logo.svg";
import "./App.scss";

import { Console, Hook, Unhook } from 'console-feed';
import { Message as MessageComponent } from "console-feed/lib/definitions/Component";
import { Message as MessageConsole } from "console-feed/lib/definitions/Console";

import { Fluence } from "@fluencelabs/fluence";
import { krasnodar } from "@fluencelabs/fluence-network-environment";
import { sayHello, startMonitor, reportMsg, registerNFTWalletMonitor } from "./_aqua/wallet-monitor";

const relayNodes = [krasnodar[0], krasnodar[1], krasnodar[2]];

const openseaEndpoint = 'https://testnets-api.opensea.io';
const raribleEndpoint = 'https://api-staging.rarible.org'

function App() {
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isMonitoring, setIsMonitoring] = useState<boolean>(false);

    const [peerIdInput, setPeerIdInput] = useState<string>("");
    const [relayPeerIdInput, setRelayPeerIdInput] = useState<string>("");
    const [walletAddressInput, setWalletAddressInput] = useState<string>("");
    const [walletAddress, setWalletAddress] = useState<string>("");

    const [lastTimestamp, setLastTimestamp] = useState<string>("");
    const [logs, setLogs] = useState<MessageConsole[]>([]);

    const connect = async (relayPeerId: string) => {
        try {
            await Fluence.start({ connectTo: relayPeerId });
            setIsConnected(true);
            registerNFTWalletMonitor({
                hello: (from) => {
                    console.info("Hello from: \n" + from);
                    return "Hello back to you, \n" + from;
                },
                monitor: (from, address) => {
                    setWalletAddress(address);
                    setIsMonitoring(true);
                    console.info(`Monitoring ${address} from ${from}`);
                    return true;
                },
                report: (from, msg) => {
                    console.info("Msg back from", from);
                    console.info(JSON.parse(msg));

                    return true
                }
            });
        } catch (err) {
            console.error("Peer initialization failed", err);
        }
    };

    // Test Connection
    const helloBtnOnClick = async () => {
        if (!Fluence.getStatus().isConnected) {
            return;
        }

        const res = await sayHello(peerIdInput, relayPeerIdInput);
        console.info(res);
    };

    const monitorBtnOnClick = async () => {
        if (!Fluence.getStatus().isConnected) {
            return;
        }

        const res = await startMonitor(peerIdInput, relayPeerIdInput, walletAddressInput);
        if (res) {
            console.info(`Wallet ${walletAddressInput} is being monitoring`);
        } else {
            console.error(`Failed to monitor on ${peerIdInput} via ${relayPeerIdInput}`);
        }
    };

    const fetchOpenseaEvents = async (currTimestamp: string) => {
        let results: string[] = [];
        let osOptions = {
            method: 'GET',
            headers: {Accept: 'application/json', 'X-API-KEY': '5bec8ae0372044cab1bef0d866c98618'}
        };
        // For more params, please check https://docs.opensea.io/reference/retrieving-events-testnets
        const openseaURL = `${openseaEndpoint}/api/v1/events?account_address=${walletAddress}&only_opensea=true&offset=0&occurred_before=${currTimestamp}&occurred_after=${lastTimestamp}`;
        const openseaRespRaw= await fetch(openseaURL, osOptions);
        const openseaRespObj = await openseaRespRaw.json()
        for (let activity of openseaRespObj.asset_events) {
            // Here we only record the event type of the response. However, there are many other fields that can be logged
            // check https://docs.opensea.io/reference/retrieving-events-testnets for more fields
            results.push(activity.event_type)
        }
        return results;
    }

    const fetchRaribleEvents = async (currTimestamp: string) => {
        let results: string[] = [];
        let rbOptions = {
            method: 'GET',
            headers: {Accept: 'application/json'}
        };
        const requestTypes = ["TRANSFER_FROM", "TRANSFER_TO", "MINT", "BURN", "MAKE_BID", "GET_BID", "LIST", "BUY", "SELL", "CANCEL_LIST", "CANCEL_BID"];
        for (let type of requestTypes) {
            // For more params, please check https://api-staging.rarible.org/v0.1/doc#operation/getActivitiesByUser
            let raribleURL = `${raribleEndpoint}/v0.1/activities/byUser?type=${type}&user=ETHEREUM:${walletAddress}&to=${(new Date(parseInt(currTimestamp) * 1000)).toISOString()}&from=${(new Date(parseInt(lastTimestamp) * 1000)).toISOString()}`;
            let raribleRespRaw = await fetch(raribleURL, rbOptions);
            let raribleRespObj = await raribleRespRaw.json();
            for (let activity of raribleRespObj.activities) {
                // Here we only record the event type of the response. However, there are many other fields that can be logged
                // check https://api-staging.rarible.org/v0.1/doc#operation/getActivitiesByUser for more fields
                results.push(type);
            }
        }
        return results;
    }

    // Here we need to do some hooking
    useEffect(() => {
        // Hook window.console so that logs can be directly displayed.
        Hook(
            window.console,
            (log) => setLogs((currLogs) => [...currLogs, log]),
            false
        );

        // Here we define our main function loop, which is to fetch events from opensea api and rarible api if a wallet is given.
        const monitorTaskInterval = setInterval(async () => {
            if (!isMonitoring || walletAddress === "") {
                return;
            }

            if (lastTimestamp === "") {
                setLastTimestamp(_ => Math.round(Date.now() / 1000).toString());
                return;
            }

            let currTimestamp = Math.round(Date.now() / 1000).toString();
            console.info(`Fetching latest events, timestamp ${currTimestamp}`);

            let results: any[] = [];

            // Fetch events from two marketplaces
            let osResults = await fetchOpenseaEvents(currTimestamp);
            let rbResults = await fetchRaribleEvents(currTimestamp);

            // Combine returned responses into one
            results = results.concat(osResults);
            results = results.concat(rbResults);
            const result = JSON.stringify(results);

            // Update timestamp
            setLastTimestamp(_ => currTimestamp);

            // Callback to host.
            await reportMsg(peerIdInput, relayPeerIdInput, result);
        }, 5000);
        return () => {Unhook(window.console as any); clearInterval(monitorTaskInterval);};
    }, [isMonitoring, walletAddress, lastTimestamp, setLastTimestamp, isConnected, peerIdInput, relayPeerIdInput, fetchOpenseaEvents, fetchRaribleEvents]);

    return (
        <div className="App">
            <header>
                <img src={logo} className="logo" alt="logo" />
            </header>

            <div className="content">
                {isConnected ? (
                    <>
                        <h1>Connected</h1>
                        <table>
                            <tbody>
                            <tr>
                                <td className="bold">Peer id:</td>
                                <td className="mono">{Fluence.getStatus().peerId!}</td>
                                <td>
                                    <button
                                        className="btn-clipboard"
                                        onClick={() => copyToClipboard(Fluence.getStatus().peerId!)}
                                    >
                                        <i className="gg-clipboard"></i>
                                    </button>
                                </td>
                            </tr>
                            <tr>
                                <td className="bold">Relay peer id:</td>
                                <td className="mono">{Fluence.getStatus().relayPeerId}</td>
                                <td>
                                    <button
                                        className="btn-clipboard"
                                        onClick={() => copyToClipboard(Fluence.getStatus().relayPeerId!)}
                                    >
                                        <i className="gg-clipboard"></i>
                                    </button>
                                </td>
                            </tr>
                            </tbody>
                        </table>

                        <div>
                            <h2>Start Monitor on Opensea and Rarible</h2>
                            <p className="p">
                                Now try opening a new tab with the same application. Copy paste
                                the peer id and relay from the second tab, then input the wallet address
                                to monitor!
                            </p>
                            <div className="row">
                                <label className="label bold">Target peer id</label>
                                <input
                                    className="input"
                                    type="text"
                                    onChange={(e) => setPeerIdInput(e.target.value)}
                                    value={peerIdInput}
                                />
                            </div>
                            <div className="row">
                                <label className="label bold">Target relay</label>
                                <input
                                    className="input"
                                    type="text"
                                    onChange={(e) => setRelayPeerIdInput(e.target.value)}
                                    value={relayPeerIdInput}
                                />
                            </div>
                            <div className="row">
                                <label className="label bold">Wallet address</label>
                                <input
                                    className="input"
                                    type="text"
                                    onChange={(e) => setWalletAddressInput(e.target.value)}
                                    value={walletAddressInput}
                                />
                            </div>
                            <div className="row">
                                <button className="btn btn-hello" onClick={helloBtnOnClick}>
                                    Test Connection
                                </button>
                            </div>

                            <div className="row">
                                <button className="btn btn-hello" onClick={monitorBtnOnClick}>
                                    Monitor
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <h1>NFT Wallet Monitor with Fluence JS & Aqua</h1>
                        <h2>Pick a relay</h2>
                        <ul>
                            {relayNodes.map((x) => (
                                <li key={x.peerId}>
                                    <span className="mono">{x.peerId}</span>
                                    <button className="btn" onClick={() => connect(x.multiaddr)}>
                                        Connect
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                <Console
                    logs={logs as MessageComponent[]}
                    variant="light"
                    styles={
                        {
                            BASE_LINE_HEIGHT: 1.2,
                            BASE_FONT_FAMILY: 'menlo, monospace',
                            BASE_FONT_SIZE: '11px',
                            LOG_ICON_WIDTH: 11,
                            LOG_ICON_HEIGHT: 12,
                            // Light mode override since the variant doesn't seem to do anything
                            LOG_COLOR: 'rgba(0,0,0,0.9)',
                            LOG_BORDER: 'rgb(240, 240, 240)',
                            LOG_WARN_BACKGROUND: 'hsl(50deg 100% 95%)',
                            LOG_WARN_BORDER: 'hsl(50deg 100% 88%)',
                            LOG_WARN_COLOR: 'hsl(39deg 100% 18%)',
                            LOG_ERROR_BACKGROUND: 'hsl(0deg 100% 97%)',
                            LOG_ERROR_BORDER: 'rgb(0deg 100% 92%)',
                            LOG_ERROR_COLOR: '#f00',
                            LOG_AMOUNT_COLOR: '#fff',
                        }
                    }
                />
            </div>
        </div>
    );
}

const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
};

export default App;