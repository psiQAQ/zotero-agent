// Compile the pure helper modules to CJS and run their node:test suites.
// (package.json is type:module, so compiled CJS needs a local commonjs marker.)
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

execSync(
  "npx tsc src/modules/authGuard.ts src/modules/evalTool.ts src/modules/mcpProtocol.ts src/modules/httpByteReader.ts src/modules/semantic/hybridSearch.ts src/modules/pdfResolvers.ts src/modules/pdfIdentifier.ts src/modules/titleSimilarity.ts src/modules/importDedup.ts src/modules/metadataMerge.ts src/modules/preprintService.ts src/modules/scihubSources.ts src/modules/scihubProxy.ts src/modules/companionBridge.ts src/modules/wosService.ts --outDir .tmp-test --module commonjs --target es2022 --skipLibCheck --moduleResolution node",
  { stdio: "inherit" },
);
mkdirSync(".tmp-test", { recursive: true });
writeFileSync(".tmp-test/package.json", '{"type":"commonjs"}');
execSync("node --test test/authGuard.test.cjs test/evalTool.test.cjs test/mcpProtocol.test.cjs test/httpByteReader.test.cjs test/hybridSearch.test.cjs test/pdfResolvers.test.cjs test/pdfIdentifier.test.cjs test/titleSimilarity.test.cjs test/importDedup.test.cjs test/metadataMerge.test.cjs test/preprintService.test.cjs test/scihubSources.test.cjs test/scihubProxy.test.cjs test/companionBridge.test.cjs test/wosService.test.cjs", { stdio: "inherit" });
