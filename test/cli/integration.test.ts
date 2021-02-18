import net from "net";
import * as path from "path";
import * as shell from "shelljs";
import * as fs from "fs";
import YAML from "yaml";
import tmp from "tmp-promise";

import { expect } from 'chai';
import { ethers } from "ethers";

import { configsFileName } from "../../src/cli/constants";
import { jsonStringToObj, keypairToCLIFormat } from "../../src/cli/utils";
import { parseProofIndirectConnectionBase64Encoded, proofIndirectConnectionToCLIFormat } from "../../src/cli/user";

import { exec } from './utils';
import { genKeypair, genPrivKey, PubKey, stringifyBigInts } from "maci-crypto";
import { abi, bytecode } from "../../src/cli/contractInfo";

import { pubkeyFactoryExclude } from "../utils";

const hardhatDefaultPrivkey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const timeoutHardhatNode = 20000;
const timeoutHubStart = 10000;

const getFreePort = async () => {
    const server = net.createServer();
    return await new Promise<number>((res, rej) => {
        server.listen(0, () => {
            const port = (server.address() as net.AddressInfo).port;
            server.once('close', () => {
                res(port);
            });
            server.on('error', (err) => {
                rej(err)
            });
            server.close();
        });
    });
};

tmp.setGracefulCleanup();

class Role {
    constructor(
        readonly dataDir: tmp.DirectoryResult,
        readonly roleName: string,
    ) {

    }

    exec(cmd: string, options?: any, loggerSilent?: boolean) {
        if (!loggerSilent) {
            return exec(`--data-dir ${this.dataDir.path} ${this.roleName} ${cmd}`, options);
        } else {
            return exec(`--silent --data-dir ${this.dataDir.path} ${this.roleName} ${cmd}`, options);
        }
    }

    async cleanup() {
        await this.dataDir.cleanup()
    }
}

const parseCLIKeypair = (s: string): { privKey: BigInt, pubKey: PubKey, pubKeyBase64Encoded: string } => {
    const obj = jsonStringToObj(s);
    if (obj.privKey === undefined || typeof obj.privKey !== 'bigint') {
        throw new Error(`obj.privKey is invalid: ${obj.privKey}`);
    }
    if (
        obj.pubKey === undefined ||
        obj.pubKey[0] === undefined ||
        obj.pubKey[1] === undefined ||
        typeof obj.pubKey[0] !== 'bigint' ||
        typeof obj.pubKey[1] !== 'bigint'
    ) {
        throw new Error(`obj.pubKey is invalid: ${obj.pubKey}`);
    }
    if (obj.pubKeyBase64Encoded === undefined || typeof obj.pubKeyBase64Encoded !== 'string') {
        throw new Error(`obj.pubKeyBase64Encoded is invalid: ${obj.pubKeyBase64Encoded}`);
    }
    return {
        privKey: obj.privKey,
        pubKey: obj.pubKey,
        pubKeyBase64Encoded: obj.pubKeyBase64Encoded
    }
}

describe("Integration test for roles", function () {
  this.timeout(400000);
  let hardhatNode;

  let hostname: string;
  let port: number;
  let url: string;

  let admin: Role;
  let hub: Role;
  let userJoined: Role;
  let userAnother: Role;
  let contractAddress: string;

  const createRole = async (
    contractAddress: string,
    roleName: string,
  ): Promise<Role> => {
    const networkOptions = {
        provider: {
            name: "web3",
            url: url,
            customContractAddress: {
                address: contractAddress,
                atBlock: 0,
            }
        }
    };
    const blindFindPrivkey = genPrivKey();
    let userOptions;
    if (roleName === 'admin') {
        userOptions = {
            network: networkOptions,
            blindFindPrivkey: blindFindPrivkey,
            admin: {
                adminEthereumPrivkey: hardhatDefaultPrivkey
            }
        };
    } else {
        userOptions = {
            network: networkOptions,
            blindFindPrivkey: blindFindPrivkey,
        };
    }
    const yamlString = YAML.stringify(stringifyBigInts(userOptions));
    const dir = await tmp.dir({ unsafeCleanup: true });
    const configFilePath = path.join(dir.path, configsFileName);
    await fs.promises.writeFile(configFilePath, yamlString, 'utf-8');
    return new Role(dir, roleName);
  };

  before(async () => {
    hostname = 'localhost';
    port = await getFreePort();
    url = `http://${hostname}:${port}`;

    hardhatNode = shell.exec(
        `npx hardhat node --hostname ${hostname} --port ${port}`,
        { async: true, silent: true },
    );

    const expectedLine = `Started HTTP and WebSocket JSON-RPC server at ${url}`;
    // Wait until hardhatNode is ready, by expecting `expectedLine` is printed.
    await new Promise((res, rej) => {
        const t = setTimeout(() => {
            res(new Error(`hardhat node is not ready after ${timeoutHardhatNode} ms`));
        }, timeoutHardhatNode)
        hardhatNode.stdout.on('data', (data: string) => {
            if (data.indexOf(expectedLine)) {
                clearTimeout(t);
                res();
            }
        })
        hardhatNode.stderr.on('data', (data: string) => {
            clearTimeout(t);
            rej(new Error(`hardhat node failed: ${data}`));
        })
    });

    // Deploy contract to hardhat node
    const provider = new ethers.providers.JsonRpcProvider(url);
    const wallet = new ethers.Wallet(hardhatDefaultPrivkey, provider);
    const BlindFindContractFactory = new ethers.ContractFactory(
        abi,
        bytecode,
        wallet,
    );
    const c = await BlindFindContractFactory.deploy();
    await c.deployed();
    contractAddress = c.address;

    // Create each role
    admin = await createRole(contractAddress, "admin");
    hub = await createRole(contractAddress, "hub");
    userJoined = await createRole(contractAddress, "user");
    userAnother = await createRole(contractAddress, "user");
  });

  after(async () => {
    hardhatNode.kill();
    await admin.cleanup();
    await hub.cleanup();
    await userJoined.cleanup();
    await userAnother.cleanup();
  })

  it("general", async () => {
    const general = await createRole(contractAddress, "general");
    const res = general.exec("genKeypair");
    parseCLIKeypair(res.stdout);
    await general.cleanup();
  });

  it("roles", async () => {
    /*
        Scenario 1: a hub candidate wants to register as a hub.
    */
    // Hub candidate signs a `hubRegistry`
    // command: blind-find hub createHubRegistry
    const printedHubRegistry = hub.exec('createHubRegistry').stdout;
    const hubRegistryB64 = jsonStringToObj(printedHubRegistry).base64Encoded;
    // Hub candidate sends the `hubRegistry` to admin. If admin approves, admin add the
    //  `hubRegistry` into the hub registry tree and send the merkle tree root on chain.
    //  Then, admin sends back the merkle proof of this `hubRegistry` back to hub candidate,
    //  and the hub candidate becomes a valid hub.
    // command: blind-find admin addHub `hubRegistryB64`
    const printedHubRegistryWithProof = admin.exec(`addHub ${hubRegistryB64}`).stdout;
    const hubRegistryWithProofB64 = jsonStringToObj(printedHubRegistryWithProof).hubRegistryWithProofBase64Encoded;
    // After receiving the merkle proof, the hub candidate needs to set the `hubRegistry` and
    //  the merkle proof in its database.
    // command: blind-find hub setHubRegistryWithProof `hubRegistryWithProofB64`
    const resSetHubRegistryWithProof = hub.exec(`setHubRegistryWithProof ${hubRegistryWithProofB64}`);
    expect(resSetHubRegistryWithProof.code).to.be.eql(0);

    /*
        Scenario 2: hub starts to serve user requests.
    */
    const hubKeypair = jsonStringToObj(hub.exec('getKeypair').stdout);
    // command: blind-find hub start
    const hubStartProcess = hub.exec(`start`, { async: true }, false);
    // Wait until hub is started
    const regex = /Listening on port (\d+)/;
    const hubPort = await new Promise<number>((res, rej) => {
        const t = setTimeout(() => {
            rej(new Error(`hub has not started after ${timeoutHubStart} ms`));
        }, timeoutHubStart);
        hubStartProcess.stdout.on('data', (data: string) => {
            const match = regex.exec(data);
            if (match !== null) {
                const portString = match[1];
                clearTimeout(t);
                if (BigInt(portString) > 65536) {
                    rej(new Error(`invalid port: port=${portString}`));
                } else {
                    res(Number(portString));
                }
            }
        });
    });

    // Let `userJoined` join `hub`
    const userJoinedKeypair = parseCLIKeypair(userJoined.exec('getKeypair').stdout);
    const resUserJoin = userJoined.exec(`join ${hostname} ${hubPort} ${hubKeypair.pubKeyBase64Encoded}`);
    expect(resUserJoin.code).to.eql(0);

    // Let `userAnother` search
    // Test: succeeds when searching for a user who has joined the hub.
    // Use tmpFile to store the result to workaround an issue in child_process
    //   Ref: https://stackoverflow.com/questions/59200052/nodejs-exec-spawn-stdout-cuts-off-the-stream-at-8192-characters/59322701#59322701
    const tmpFile = await tmp.tmpName();
    const userAnotherKeypair = parseCLIKeypair(userAnother.exec('getKeypair').stdout);
    const resUserAnotherSearch = userAnother.exec(`search ${hostname} ${hubPort} ${userJoinedKeypair.pubKeyBase64Encoded} > ${tmpFile}`);
    expect(resUserAnotherSearch.code).to.eql(0);
    const data = await fs.promises.readFile(tmpFile, { encoding: 'utf-8' });
    const proofBase64 = JSON.parse(data).base64Encoded;
    const proof = parseProofIndirectConnectionBase64Encoded(proofBase64);
    expect(proof.pubkeyA).to.eql(userAnotherKeypair.pubKey);
    expect(proof.pubkeyC).to.eql(userJoinedKeypair.pubKey);

    // Test: fails when searching for a user who hasn't joined the hub.
    const randomPubkeyB64 = keypairToCLIFormat(genKeypair()).pubKeyBase64Encoded;
    const resUserAnotherSearchFailure = userAnother.exec(`search ${hostname} ${hubPort} ${randomPubkeyB64}`, { fatal: false });
    expect(resUserAnotherSearchFailure.code).to.eql(1);

    // Test: Verify the proof with `verifyProof`
    const resUserAnotherVerifyProof = userAnother.exec(`verifyProof ${proofBase64}`);
    expect(resUserAnotherVerifyProof.code).to.eql(0);
    const wrongProof = {
        pubkeyA: proof.pubkeyA,
        pubkeyC: pubkeyFactoryExclude([proof.pubkeyC]),
        adminAddress: proof.adminAddress,
        proofOfSMP: proof.proofOfSMP,
        proofSuccessfulSMP: proof.proofSuccessfulSMP,
    }
    const wrongProofBase64 = proofIndirectConnectionToCLIFormat(wrongProof).base64Encoded;
    const resUserAnotherVerifyProofFailed = userAnother.exec(`verifyProof ${wrongProofBase64}`);
    expect(resUserAnotherVerifyProofFailed.code).to.eql(1);
  });
});

