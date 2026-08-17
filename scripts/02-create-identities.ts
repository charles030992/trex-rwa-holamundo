import { ethers } from 'hardhat';
import OnchainID from '@onchain-id/solidity';
import TREXSuite from '@erc3643org/erc-3643';
import * as fs from 'fs';
import * as path from 'path';

// Mismo patrón que en 01-deploy-suite.ts: desplegamos desde el artifact
// precompilado en vez de por nombre, porque nuestro contracts/ está vacío.
async function deployFromArtifact(artifact: { abi: any; bytecode: string }, args: any[] = [], signer: any) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  return factory.deploy(...args);
}

async function main() {
  const deploymentPath = path.join(__dirname, '..', 'deployments', 'localhost.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));

  // Mismo orden de signers que en 01-deploy-suite.ts (deployer, tokenAgent, claimIssuer),
  // seguido de alice y bob como las siguientes cuentas de prueba de Hardhat.
  const [deployer, tokenAgent, , alice, bob] = await ethers.getSigners();

  console.log('Alice:', alice.address);
  console.log('Bob:  ', bob.address);
  console.log('');

  // --- Identidad OnchainID de cada wallet ---
  // IdentityProxy(implementationAuthority, managementKey): managementKey es la
  // wallet que controla la identidad (puede añadir/quitar claims sobre sí misma).
  const aliceIdentityProxy = await deployFromArtifact(
    OnchainID.contracts.IdentityProxy,
    [deployment.identityImplementationAuthority ?? deployment.suite.identityImplementationAuthority, alice.address],
    deployer,
  );
  const aliceIdentity = await ethers.getContractAt(OnchainID.contracts.Identity.abi, aliceIdentityProxy.address);

  const bobIdentityProxy = await deployFromArtifact(
    OnchainID.contracts.IdentityProxy,
    [deployment.identityImplementationAuthority ?? deployment.suite.identityImplementationAuthority, bob.address],
    deployer,
  );
  const bobIdentity = await ethers.getContractAt(OnchainID.contracts.Identity.abi, bobIdentityProxy.address);

  console.log('Identidad de Alice:', aliceIdentity.address);
  console.log('Identidad de Bob:  ', bobIdentity.address);

  // --- Registro en el IdentityRegistry: enlaza wallet <-> identidad + país ---
  // Un wallet registrado sin claim de KYC sigue sin estar "verificado" (isVerified
  // depende de tener las claims exigidas, no solo de estar registrado). Este es el
  // estado en el que dejamos a Bob: registrado, pero sin claim todavía.
  const identityRegistry = await ethers.getContractAt(TREXSuite.contracts.IdentityRegistry.abi, deployment.suite.identityRegistry);

  const COUNTRY_CODE = 724; // ISO 3166-1 numeric: España, arbitrario para este ejercicio

  await (
    await identityRegistry
      .connect(tokenAgent)
      .batchRegisterIdentity([alice.address, bob.address], [aliceIdentity.address, bobIdentity.address], [COUNTRY_CODE, COUNTRY_CODE])
  ).wait();

  console.log('\nAlice y Bob registrados en el IdentityRegistry (ninguno tiene claim KYC todavía).');

  // --- Guardar para los siguientes pasos ---
  deployment.actors = {
    alice: { address: alice.address, identity: aliceIdentity.address },
    bob: { address: bob.address, identity: bobIdentity.address },
  };
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log('Direcciones de Alice y Bob guardadas en deployments/localhost.json');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
