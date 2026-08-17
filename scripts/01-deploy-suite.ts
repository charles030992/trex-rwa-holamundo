import { ethers } from 'hardhat';
import TREXSuite from '@erc3643org/erc-3643';
import OnchainID from '@onchain-id/solidity';
import * as fs from 'fs';
import * as path from 'path';

// Despliega un contrato a partir de un artifact precompilado {abi, bytecode}
// en vez de por nombre (Hardhat no conoce estos contratos porque no viven en
// nuestro propio contracts/, así que ethers.deployContract('Nombre', ...) no
// funcionaría aquí).
async function deployFromArtifact(artifact: { abi: any; bytecode: string }, args: any[] = [], signer: any) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  return factory.deploy(...args);
}

async function main() {
  const [deployer, tokenAgent, claimIssuer] = await ethers.getSigners();

  console.log('Deployer:    ', deployer.address);
  console.log('Token Agent: ', tokenAgent.address);
  console.log('Claim Issuer:', claimIssuer.address);
  console.log('');

  // --- 1. Implementaciones: la lógica de cada contrato, sin estado propio todavía ---
  const claimTopicsRegistryImplementation = await deployFromArtifact(TREXSuite.contracts.ClaimTopicsRegistry, [], deployer);
  const trustedIssuersRegistryImplementation = await deployFromArtifact(TREXSuite.contracts.TrustedIssuersRegistry, [], deployer);
  const identityRegistryStorageImplementation = await deployFromArtifact(TREXSuite.contracts.IdentityRegistryStorage, [], deployer);
  const identityRegistryImplementation = await deployFromArtifact(TREXSuite.contracts.IdentityRegistry, [], deployer);
  const modularComplianceImplementation = await deployFromArtifact(TREXSuite.contracts.ModularCompliance, [], deployer);
  const tokenImplementation = await deployFromArtifact(TREXSuite.contracts.Token, [], deployer);
  console.log('[1/7] Implementaciones desplegadas.');

  // --- 2. Infraestructura de identidad OnchainID (para crear identidades más adelante) ---
  const identityImplementation = await deployFromArtifact(OnchainID.contracts.Identity, [deployer.address, true], deployer);
  const identityImplementationAuthority = await deployFromArtifact(
    OnchainID.contracts.ImplementationAuthority,
    [identityImplementation.address],
    deployer,
  );
  const identityFactory = await deployFromArtifact(OnchainID.contracts.Factory, [identityImplementationAuthority.address], deployer);
  console.log('[2/7] Infraestructura OnchainID desplegada.');

  // --- 3. Autoridad de implementación T-REX: registra qué versión de cada contrato usar ---
  const trexImplementationAuthority = await deployFromArtifact(
    TREXSuite.contracts.TREXImplementationAuthority,
    [true, ethers.constants.AddressZero, ethers.constants.AddressZero],
    deployer,
  );

  const versionStruct = { major: 4, minor: 0, patch: 0 };
  const contractsStruct = {
    tokenImplementation: tokenImplementation.address,
    ctrImplementation: claimTopicsRegistryImplementation.address,
    irImplementation: identityRegistryImplementation.address,
    irsImplementation: identityRegistryStorageImplementation.address,
    tirImplementation: trustedIssuersRegistryImplementation.address,
    mcImplementation: modularComplianceImplementation.address,
  };
  await (await trexImplementationAuthority.connect(deployer).addAndUseTREXVersion(versionStruct, contractsStruct)).wait();

  const trexFactory = await deployFromArtifact(
    TREXSuite.contracts.TREXFactory,
    [trexImplementationAuthority.address, identityFactory.address],
    deployer,
  );
  await (await identityFactory.connect(deployer).addTokenFactory(trexFactory.address)).wait();
  console.log('[3/7] TREXImplementationAuthority + TREXFactory desplegados y enlazados.');

  // --- 4. Proxies: las instancias reales de registries y compliance que vamos a usar ---
  const claimTopicsRegistryProxy = await deployFromArtifact(
    TREXSuite.contracts.ClaimTopicsRegistryProxy,
    [trexImplementationAuthority.address],
    deployer,
  );
  const claimTopicsRegistry = await ethers.getContractAt(TREXSuite.contracts.ClaimTopicsRegistry.abi, claimTopicsRegistryProxy.address);

  const trustedIssuersRegistryProxy = await deployFromArtifact(
    TREXSuite.contracts.TrustedIssuersRegistryProxy,
    [trexImplementationAuthority.address],
    deployer,
  );
  const trustedIssuersRegistry = await ethers.getContractAt(TREXSuite.contracts.TrustedIssuersRegistry.abi, trustedIssuersRegistryProxy.address);

  const identityRegistryStorageProxy = await deployFromArtifact(
    TREXSuite.contracts.IdentityRegistryStorageProxy,
    [trexImplementationAuthority.address],
    deployer,
  );
  const identityRegistryStorage = await ethers.getContractAt(TREXSuite.contracts.IdentityRegistryStorage.abi, identityRegistryStorageProxy.address);

  const complianceProxy = await deployFromArtifact(TREXSuite.contracts.ModularComplianceProxy, [trexImplementationAuthority.address], deployer);
  const compliance = await ethers.getContractAt(TREXSuite.contracts.ModularCompliance.abi, complianceProxy.address);

  const identityRegistryProxy = await deployFromArtifact(
    TREXSuite.contracts.IdentityRegistryProxy,
    [trexImplementationAuthority.address, trustedIssuersRegistry.address, claimTopicsRegistry.address, identityRegistryStorage.address],
    deployer,
  );
  const identityRegistry = await ethers.getContractAt(TREXSuite.contracts.IdentityRegistry.abi, identityRegistryProxy.address);
  console.log('[4/7] Registries y Compliance desplegados (proxies).');

  // --- 5. Identidad on-chain del propio Token, y el Token en sí ---
  const tokenOIDProxy = await deployFromArtifact(
    OnchainID.contracts.IdentityProxy,
    [identityImplementationAuthority.address, deployer.address],
    deployer,
  );
  const tokenOID = await ethers.getContractAt(OnchainID.contracts.Identity.abi, tokenOIDProxy.address);

  const tokenName = 'Hola Mundo RWA Token';
  const tokenSymbol = 'HMRWA';
  const tokenDecimals = 0;

  const tokenProxy = await deployFromArtifact(
    TREXSuite.contracts.TokenProxy,
    [trexImplementationAuthority.address, identityRegistry.address, compliance.address, tokenName, tokenSymbol, tokenDecimals, tokenOID.address],
    deployer,
  );
  const token = await ethers.getContractAt(TREXSuite.contracts.Token.abi, tokenProxy.address);
  console.log('[5/7] Token desplegado:', token.address, `(${tokenSymbol}) — DESPLEGADO EN PAUSA, falta unpause() en el paso 4.5`);

  // --- 6. Cableado: enlazar storage <-> registry, y dar rol de agente ---
  await (await identityRegistryStorage.connect(deployer).bindIdentityRegistry(identityRegistry.address)).wait();
  await (await token.connect(deployer).addAgent(tokenAgent.address)).wait();
  await (await identityRegistry.connect(deployer).addAgent(tokenAgent.address)).wait();
  await (await identityRegistry.connect(deployer).addAgent(token.address)).wait();
  console.log('[6/7] Storage enlazado al registry, roles de agente asignados.');

  // --- 7. Claim topic KYC + emisor de confianza (todavía sin identidades de Alice/Bob) ---
  const KYC_TOPIC = ethers.utils.id('KYC');
  await (await claimTopicsRegistry.connect(deployer).addClaimTopic(KYC_TOPIC)).wait();

  const claimIssuerSigningKey = ethers.Wallet.createRandom();
  const claimIssuerContractRaw = await deployFromArtifact(OnchainID.contracts.ClaimIssuer, [claimIssuer.address], claimIssuer);
  const claimIssuerContract = await ethers.getContractAt(OnchainID.contracts.ClaimIssuer.abi, claimIssuerContractRaw.address);

  await (
    await claimIssuerContract
      .connect(claimIssuer)
      .addKey(ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['address'], [claimIssuerSigningKey.address])), 3, 1)
  ).wait();

  await (await trustedIssuersRegistry.connect(deployer).addTrustedIssuer(claimIssuerContract.address, [KYC_TOPIC])).wait();
  console.log('[7/7] Claim topic KYC registrado, emisor de confianza configurado y su clave de firma dada de alta.');

  // --- Guardar todo para los siguientes pasos (4.3 en adelante) ---
  const deployment = {
    network: 'localhost',
    deployedAt: new Date().toISOString(),
    accounts: {
      deployer: deployer.address,
      tokenAgent: tokenAgent.address,
      claimIssuer: claimIssuer.address,
    },
    claimIssuerSigningKey: {
      address: claimIssuerSigningKey.address,
      privateKey: claimIssuerSigningKey.privateKey,
    },
    kycTopic: KYC_TOPIC,
    suite: {
      trexImplementationAuthority: trexImplementationAuthority.address,
      trexFactory: trexFactory.address,
      identityImplementationAuthority: identityImplementationAuthority.address,
      identityFactory: identityFactory.address,
      claimTopicsRegistry: claimTopicsRegistry.address,
      trustedIssuersRegistry: trustedIssuersRegistry.address,
      identityRegistryStorage: identityRegistryStorage.address,
      identityRegistry: identityRegistry.address,
      compliance: compliance.address,
      token: token.address,
      tokenOID: tokenOID.address,
      claimIssuerContract: claimIssuerContract.address,
    },
  };

  const outDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'localhost.json'), JSON.stringify(deployment, null, 2));

  console.log('\nDirecciones y claves de este despliegue guardadas en deployments/localhost.json');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
