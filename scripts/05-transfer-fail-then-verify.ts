import { ethers } from 'hardhat';
import TREXSuite from '@erc3643org/erc-3643';
import OnchainID from '@onchain-id/solidity';
import * as fs from 'fs';
import * as path from 'path';

// Paso 4.6: el contraste completo del ejercicio.
// 1) Alice intenta transferir a Bob -> revierte ("identity not verified"), porque
//    Bob está registrado (paso 4.3) pero sin claim KYC.
// 2) Verificamos a Bob (mismo procedimiento que para Alice en el paso 4.4).
// 3) Repetimos el mismo transfer -> ahora funciona.
async function main() {
  const deploymentPath = path.join(__dirname, '..', 'deployments', 'localhost.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));

  const [, , , alice, bob] = await ethers.getSigners();

  const token = await ethers.getContractAt(TREXSuite.contracts.Token.abi, deployment.suite.token);
  const identityRegistry = await ethers.getContractAt(TREXSuite.contracts.IdentityRegistry.abi, deployment.suite.identityRegistry);

  const TRANSFER_AMOUNT = 100;

  console.log('¿Alice verificada?', await identityRegistry.isVerified(alice.address));
  console.log('¿Bob verificado?  ', await identityRegistry.isVerified(bob.address));

  console.log('\n--- Intento 1: Alice -> Bob (Bob sin claim KYC) ---');
  try {
    await (await token.connect(alice).transfer(bob.address, TRANSFER_AMOUNT)).wait();
    console.log('Inesperado: el transfer NO revirtió.');
  } catch (error: any) {
    console.log('Revirtió como se esperaba. Motivo:', error.reason ?? error.message);
  }

  console.log('\n--- Verificando a Bob (mismo procedimiento que con Alice en el paso 4.4) ---');
  const bobIdentity = await ethers.getContractAt(OnchainID.contracts.Identity.abi, deployment.actors.bob.identity);
  const claimIssuerSigningKey = new ethers.Wallet(deployment.claimIssuerSigningKey.privateKey);

  const claimForBob = {
    data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('KYC verificado — ejercicio trex-rwa-holamundo')),
    issuer: deployment.suite.claimIssuerContract,
    topic: deployment.kycTopic,
    scheme: 1,
    identity: bobIdentity.address,
    signature: '',
  };
  claimForBob.signature = await claimIssuerSigningKey.signMessage(
    ethers.utils.arrayify(
      ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(['address', 'uint256', 'bytes'], [claimForBob.identity, claimForBob.topic, claimForBob.data]),
      ),
    ),
  );

  await (
    await bobIdentity
      .connect(bob)
      .addClaim(claimForBob.topic, claimForBob.scheme, claimForBob.issuer, claimForBob.signature, claimForBob.data, '')
  ).wait();

  console.log('¿Bob verificado ahora?', await identityRegistry.isVerified(bob.address));

  console.log('\n--- Intento 2: Alice -> Bob (Bob ya verificado) ---');
  await (await token.connect(alice).transfer(bob.address, TRANSFER_AMOUNT)).wait();

  const aliceBalance = await token.balanceOf(alice.address);
  const bobBalance = await token.balanceOf(bob.address);
  console.log('Transfer completado.');
  console.log('Balance de Alice:', aliceBalance.toString(), 'HMRWA');
  console.log('Balance de Bob:  ', bobBalance.toString(), 'HMRWA');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
