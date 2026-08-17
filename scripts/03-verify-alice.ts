import { ethers } from 'hardhat';
import OnchainID from '@onchain-id/solidity';
import * as fs from 'fs';
import * as path from 'path';

// Paso 4.4: crear un claim KYC firmado por el claimIssuer y añadirlo SOLO a la
// identidad de Alice. Bob se queda registrado (paso 4.3) pero sin claim, así que
// seguirá sin estar "verificado" quando lo comprobemos en el paso 4.6.
async function main() {
  const deploymentPath = path.join(__dirname, '..', 'deployments', 'localhost.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));

  const [, , , alice] = await ethers.getSigners();

  const aliceIdentity = await ethers.getContractAt(OnchainID.contracts.Identity.abi, deployment.actors.alice.identity);

  // Wallet "offline" que solo firma — no necesita ETH ni provider, es la misma
  // clave privada generada en 01-deploy-suite.ts para el claimIssuer.
  const claimIssuerSigningKey = new ethers.Wallet(deployment.claimIssuerSigningKey.privateKey);

  const claimForAlice = {
    data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes('KYC verificado — ejercicio trex-rwa-holamundo')),
    issuer: deployment.suite.claimIssuerContract,
    topic: deployment.kycTopic,
    scheme: 1,
    identity: aliceIdentity.address,
    signature: '',
  };

  // El claim se firma sobre keccak256(identity, topic, data) — así el
  // IdentityRegistry/Token pueden validar más tarde que la firma es del
  // trusted issuer, sin tener que confiar en el dato en sí.
  claimForAlice.signature = await claimIssuerSigningKey.signMessage(
    ethers.utils.arrayify(
      ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(['address', 'uint256', 'bytes'], [claimForAlice.identity, claimForAlice.topic, claimForAlice.data]),
      ),
    ),
  );

  await (
    await aliceIdentity
      .connect(alice)
      .addClaim(claimForAlice.topic, claimForAlice.scheme, claimForAlice.issuer, claimForAlice.signature, claimForAlice.data, '')
  ).wait();

  console.log('Claim KYC añadido a la identidad de Alice.');
  console.log('Bob sigue sin claim — no está verificado.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
