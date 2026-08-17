# trex-rwa-holamundo

Proyecto de aprendizaje técnico (no comercial) para entender el estándar **ERC-3643 / suite T-REX** desplegándolo en una testnet local y provocando deliberadamente un fallo de compliance para luego resolverlo.

> La teoría y las decisiones de arquitectura se discuten en una conversación aparte en claude.ai. Este README es el punto de retoma técnico dentro de Claude Code: si se interrumpe el trabajo, empezar por aquí.

---

## Objetivo de la primera entrega

Desplegar la suite T-REX completa en Hardhat local y provocar un `transfer` que revierte con "identity not verified" (Bob, sin verificar). Luego verificar a Bob y comprobar que el mismo transfer funciona. El contraste **falla → verifico → funciona** es el objetivo completo.

---

## Decisiones de arquitectura

| Decisión | Valor | Motivo |
|---|---|---|
| Red | Hardhat Network local (no testnet pública) | Es un ejercicio, no hace falta desplegar fuera |
| Framework | **Hardhat 2.x** (`^2.14.0`), no Hardhat 3 | Hardhat 3 cambia el sistema de config/plugins; T-REX y OnchainID están construidos y probados sobre Hardhat 2. Ver nota abajo. |
| Suite T-REX | Paquete npm `@erc3643org/erc-3643@4.1.3` | Mismo código y versión que `reference/ERC-3643-source/`, pero instalado como dependencia en vez de copiado. Incluye contratos fuente Y artifacts precompilados. |
| OnchainID | Paquete npm `@onchain-id/solidity@2.2.1` | Implementación oficial de identidad on-chain, paquete separado de la suite T-REX |
| Compilador Solidity | `0.8.17` | Versión exacta que usa la suite T-REX (ver su `hardhat.config.ts` de referencia) |
| Claim de prueba | KYC | El propio usuario actúa como trusted issuer que lo firma |
| Actores | Alice (se verifica) / Bob (se deja sin verificar) | Para forzar el revert en Bob |

**⚠️ Nota Hardhat 2 vs 3**: si en algún momento se reinstalan dependencias desde cero con `npm install hardhat @nomicfoundation/hardhat-toolbox` sin fijar versión, npm traerá Hardhat 3 por defecto. Instalar siempre con versión fijada: `hardhat@^2.14.0 @nomicfoundation/hardhat-toolbox@^2.0.2`.

---

## Qué se usa tal cual vs qué es referencia

- `reference/ERC-3643-source/` — clon del repo oficial, **solo consulta**, excluido de git. No es código propio.
- `node_modules/@erc3643org/erc-3643/` y `node_modules/@onchain-id/solidity/` — la suite real que se despliega, instalada como dependencia npm.
- `contracts/`, `scripts/`, `test/` — código propio de este ejercicio (scripts de deploy, pruebas del escenario Alice/Bob).

---

## Progreso

### ✅ Pasos 1-3 — Entorno, proyecto, dependencias (completado 2026-08-11)

- Node v22.16.0 / npm 10.9.2 (ya cumplían)
- `hardhat.config.ts` + `tsconfig.json` creados
- Carpetas `contracts/`, `scripts/`, `test/` creadas
- Dependencias instaladas: `hardhat@2.29.0`, `@nomicfoundation/hardhat-toolbox@2.0.2`, `typescript`, `ts-node`, `@erc3643org/erc-3643@4.1.3`, `@onchain-id/solidity@2.2.1`, `@openzeppelin/contracts@^4.9.6`
- Verificado con `npx hardhat compile` (sin errores)

### ✅ Paso 4.1 — Levantar testnet local (completado 2026-08-11)

```bash
npx hardhat node
```

Levanta el servidor JSON-RPC en `http://127.0.0.1:8545` (chainId `31337` / `0x7a69`), con 20 cuentas de prueba de 10.000 ETH ficticios cada una. Las claves privadas de estas cuentas son **públicas y conocidas** (estándar de Hardhat) — sin ningún valor real, solo válidas en esta red local.

**Para retomar si el proceso se ha parado**: volver a ejecutar `npx hardhat node` en una terminal y dejarlo corriendo. El resto de pasos se ejecutan contra `--network localhost` en otra terminal/script, mientras el nodo siga vivo.

### ✅ Paso 4.2 — Deploy de contratos en el orden correcto (completado 2026-08-11)

Script: `scripts/01-deploy-suite.ts`. Ejecutar con:
```bash
npx hardhat run scripts/01-deploy-suite.ts --network localhost
```

**Hallazgo clave (probable origen de la fricción original)**: nuestro `contracts/` está vacío, así que Hardhat no puede resolver contratos T-REX por nombre (`ethers.deployContract('ClaimTopicsRegistry', ...)` falla). Solución verificada: los paquetes `@erc3643org/erc-3643` y `@onchain-id/solidity` exportan sus contratos ya compilados vía `import TREXSuite from '@erc3643org/erc-3643'` → `TREXSuite.contracts.NombreContrato.{abi,bytecode}`. Se despliegan con `ethers.ContractFactory(abi, bytecode, signer).deploy(...)`, sin necesidad de compilar nada propio.

**Orden real desplegado** (verificado contra `reference/ERC-3643-source/test/fixtures/deploy-full-suite.fixture.ts`, la fuente de verdad oficial):
1. Implementaciones (lógica, sin proxy): `ClaimTopicsRegistry`, `TrustedIssuersRegistry`, `IdentityRegistryStorage`, `IdentityRegistry`, `ModularCompliance`, `Token`
2. Infraestructura OnchainID: `Identity` (implementación), `ImplementationAuthority`, `Factory` (de identidades)
3. `TREXImplementationAuthority` (registra qué implementación usa cada contrato) + `TREXFactory`
4. Proxies reales: `ClaimTopicsRegistryProxy`, `TrustedIssuersRegistryProxy`, `IdentityRegistryStorageProxy`, `ModularComplianceProxy`, `IdentityRegistryProxy`
5. Identidad on-chain del propio token (`tokenOID`) + `TokenProxy` — **el Token se despliega en pausa**, hay que llamar `unpause()` explícitamente (pendiente para el 4.5) o ningún transfer funcionará, ni siquiera a una cuenta verificada
6. Cableado: `identityRegistryStorage.bindIdentityRegistry(...)`, roles de agente (`addAgent`) en Token e IdentityRegistry
7. Configuración de compliance: claim topic `KYC` registrado, `ClaimIssuer` desplegado y dado de alta como emisor de confianza en `TrustedIssuersRegistry`

**Direcciones desplegadas**: guardadas en `deployments/localhost.json` (gitignored — son artefactos de esta instancia local del nodo, no código). Incluye también la clave privada del `claimIssuerSigningKey` (aleatoria, generada con `ethers.Wallet.createRandom()`, solo para firmar claims en esta red local — sin ningún valor real, se necesita en el paso 4.4 para firmar el claim KYC de Alice).

### ✅ Paso 4.3 — Crear identidades (OnchainID) para Alice y Bob (completado 2026-08-17)

Script: `scripts/02-create-identities.ts`. Despliega un `IdentityProxy` de OnchainID por cada wallet (Alice = cuenta #3, Bob = cuenta #4 de Hardhat) y los registra en el `IdentityRegistry` vía `batchRegisterIdentity` (rol de agente, firmado por `tokenAgent`). Estar registrado **no** implica estar verificado: verificación depende de tener las claims exigidas, no solo de la entrada en el registry. Direcciones guardadas en `deployments/localhost.json` → `actors.alice` / `actors.bob`.

### ✅ Paso 4.4 — Verificar solo a Alice: crear y firmar el claim KYC (completado 2026-08-17)

Script: `scripts/03-verify-alice.ts`. Se firma un claim KYC con `claimIssuerSigningKey` (clave generada en el paso 4.2) sobre `keccak256(identity, topic, data)`, y se añade a la identidad de Alice con `addClaim`. Bob no recibe claim en este paso — queda deliberadamente sin verificar.

### ✅ Paso 4.5 — Mint de tokens a Alice + `unpause()` (completado 2026-08-17)

Script: `scripts/04-mint-and-unpause.ts`. Mint de 1000 HMRWA a Alice (única verificada) desde `tokenAgent`, luego `unpause()` del token.

### ✅ Paso 4.6 — Transfer Alice→Bob: falla → verifico a Bob → funciona (completado 2026-08-17)

Script: `scripts/05-transfer-fail-then-verify.ts`. El contraste completo, objetivo de la primera entrega:
1. `token.connect(alice).transfer(bob, 100)` → **revierte** con `"Transfer not possible"` (Bob registrado pero sin claim KYC → `isVerified(bob) == false`).
2. Se verifica a Bob repitiendo el procedimiento del paso 4.4 (claim KYC firmado por el mismo `claimIssuer`).
3. Se repite el mismo transfer → **funciona**. Balances finales: Alice 900 HMRWA, Bob 100 HMRWA.

**Nota sobre el mensaje de revert**: el objetivo original de este README decía que el revert sería `"identity not verified"`. El mensaje real en `Token.sol` para un `transfer()` normal es el genérico `"Transfer not possible"` (revert catch-all en `_transferChecks`); el mensaje específico `"Identity is not verified."` solo se usa en el `require` de `mint()`. El mecanismo de fondo (Bob no verificado bloquea el transfer) es el mismo, solo cambia el string.

**🎉 Objetivo de la primera entrega completado.** Suite T-REX desplegada en Hardhat local, Alice y Bob con identidades OnchainID, verificación selectiva vía claims KYC, y el contraste falla→verifico→funciona demostrado de punta a punta.

---

## ⚠️ Importante: el nodo local NO conserva estado entre sesiones

La Hardhat Network (`npx hardhat node`) es una blockchain **en memoria**. Al cerrarla (o al reiniciar el ordenador), **todo lo desplegado se pierde** — el contenido de `deployments/localhost.json` deja de ser válido, aunque el archivo siga en disco.

**Por eso, al retomar el trabajo en una sesión nueva, el orden es:**
1. `npx hardhat node` (levantar el nodo de nuevo, queda vacío)
2. `npx hardhat run scripts/01-deploy-suite.ts --network localhost` (**redesplegar la suite entera** — el script tarda segundos, no hay que dar por bueno el `deployments/localhost.json` anterior sin regenerarlo)
3. Continuar por el primer paso marcado `⏳` de la lista de arriba (a día de hoy, el 4.3)

No hace falta rehacer los pasos 1-3 (instalación) salvo que se borre `node_modules/` — esos sí son persistentes en disco.

---

## Cierre de sesión — 2026-08-12

- Nodo local (`npx hardhat node`) **detenido** deliberadamente al cerrar la sesión (ver nota de arriba: no tiene sentido dejarlo corriendo entre sesiones porque su estado no se usa de todas formas hasta que se redespliegue).
- Todo el código de los pasos 1-3, 4.1 y 4.2 está guardado en disco (`hardhat.config.ts`, `tsconfig.json`, `scripts/01-deploy-suite.ts`, este README) — nada de esto se pierde al parar el nodo.
- `deployments/localhost.json` de esta sesión queda en disco solo como referencia histórica de que el script funcionó; **no usar sus direcciones directamente en la próxima sesión**, hay que regenerarlo.
- Pendiente para la próxima sesión: retomar en el paso 4.3, después de repetir los dos comandos de arriba.
- El usuario se ha llevado un prompt de resumen a claude.ai para repasar la teoría de los pasos 1-3/4.1/4.2 "como si fuera a mano" antes de continuar con la implementación.

---

## Cómo retomar el trabajo

1. Leer este README para ver en qué paso se quedó (sección "Progreso" arriba).
2. Levantar el nodo y redesplegar la suite (ver sección "El nodo local NO conserva estado" arriba) — **paso obligatorio siempre que se reinicie el nodo**.
3. Continuar por el primer paso marcado `⏳`.
4. Actualizar este README al cerrar cada paso (checkbox + fecha + código relevante), y la carpeta de memoria de Claude Code si cambia alguna decisión de arquitectura.
