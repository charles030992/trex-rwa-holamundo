import { ethers } from 'hardhat';
import TREXSuite from '@erc3643org/erc-3643';
import * as fs from 'fs';
import * as path from 'path';

// Paso 4.5: mint a Alice (única verificada hasta ahora) y unpause() del token.
// El Token se desplegó en pausa en 01-deploy-suite.ts — sin este unpause ningún
// transfer funcionaría, ni siquiera entre cuentas verificadas.
async function main() {
  const deploymentPath = path.join(__dirname, '..', 'deployments', 'localhost.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));

  const [, tokenAgent] = await ethers.getSigners();

  const token = await ethers.getContractAt(TREXSuite.contracts.Token.abi, deployment.suite.token);

  const MINT_AMOUNT = 1000;
  await (await token.connect(tokenAgent).mint(deployment.actors.alice.address, MINT_AMOUNT)).wait();
  console.log(`Mint de ${MINT_AMOUNT} HMRWA a Alice.`);

  await (await token.connect(tokenAgent).unpause()).wait();
  console.log('Token despausado.');

  const aliceBalance = await token.balanceOf(deployment.actors.alice.address);
  console.log('Balance de Alice:', aliceBalance.toString(), 'HMRWA');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
