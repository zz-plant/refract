import { readFileSync, writeFileSync } from "node:fs";
import type { BundleSignatureResult, VerificationBundle } from "@refract-org/evidence-graph";
import { verifyBundleSignature, verifyVerificationBundle } from "@refract-org/evidence-graph";
import { renderVerificationHtmlReceipt } from "../html-renderer.js";
import { bold, cyan, dim, green, red, success } from "../render.js";

export async function runVerify(bundlePath: string, htmlOutPath?: string, publicKeyPath?: string): Promise<void> {
  let trustedKey: string | undefined;
  if (publicKeyPath) {
    try {
      trustedKey = readFileSync(publicKeyPath, "utf-8");
    } catch (err) {
      console.error(red(`Failed to read public key at "${publicKeyPath}": ${err}`));
      process.exit(1);
    }
  }

  let rawJson: string;
  try {
    rawJson = readFileSync(bundlePath, "utf-8");
  } catch (err) {
    console.error(red(`Failed to read verification bundle file at "${bundlePath}": ${err}`));
    process.exit(1);
  }

  let bundle: VerificationBundle;
  try {
    bundle = JSON.parse(rawJson) as VerificationBundle;
  } catch (err) {
    console.error(red(`Failed to parse verification bundle JSON: ${err}`));
    process.exit(1);
  }

  const result = verifyVerificationBundle(bundle);
  const signature = verifyBundleSignature(bundle, trustedKey);
  // A signature that fails, or a trusted key the bundle was not signed with,
  // fails verification; an unsigned bundle without --public-key does not.
  const signatureFails = signature.status === "invalid" || (trustedKey !== undefined && !signature.trusted);

  console.log(bold("\nRefract verification bundle"));
  console.log(dim("──────────────────────────────────────────────────"));
  console.log(`Page:          ${cyan(bundle.manifest?.pageTitle || "unknown")}`);
  console.log(`Generated:     ${bundle.manifest?.generatedAt || "unknown"}`);
  console.log(`Manifest hash: ${bundle.manifest?.manifestHash || "none"}`);
  console.log(`Merkle root:   ${bundle.manifest?.merkleRoot || "none"}`);
  console.log(`Events:        ${bundle.events?.length ?? 0}`);
  console.log(`Proofs:        ${bundle.proofs?.length ?? 0}`);
  console.log(`Signature:     ${describeSignature(signature, trustedKey !== undefined)}`);
  console.log(dim("──────────────────────────────────────────────────"));

  if (result.valid) {
    console.log(
      success(
        "Checks passed: manifest hash, Merkle root, each event against the hash listed for it, one proof per hash up to the manifest's root.",
      ),
    );
    console.log(
      dim(
        `Not checked: event fields outside the event hash (layer, claimId, schemaVersion, enrichment fields, fact provenance, modelInterpretation), or that the events follow from the revisions.${
          signature.trusted
            ? ""
            : signature.status === "valid"
              ? " The signature was checked against the key the bundle carries, which says nothing about who holds it; pass --public-key with a key you trust."
              : " Nothing in the bundle is signed."
        }`,
      ),
    );
  } else {
    console.error(red("Checks failed:"));
    for (const err of result.errors) {
      console.error(red(`  - ${err}`));
    }
  }

  if (htmlOutPath) {
    const html = renderVerificationHtmlReceipt(bundle, result);
    try {
      writeFileSync(htmlOutPath, html, "utf-8");
      console.log(green(`\nSaved verification HTML receipt to: ${htmlOutPath}`));
    } catch (err) {
      console.error(red(`Failed to write HTML receipt to "${htmlOutPath}": ${err}`));
    }
  }

  if (signatureFails) {
    console.error(red(`Signature check failed: ${signature.error ?? "not signed with the trusted key"}`));
  }

  if (!result.valid || signatureFails) {
    process.exit(1);
  }
}

function describeSignature(signature: BundleSignatureResult, keyGiven: boolean): string {
  if (signature.status === "unsigned") return keyGiven ? red("none (a trusted key was given)") : "none";
  if (signature.status === "invalid") return red(`invalid, key ${signature.keyId ?? "unknown"}`);
  if (signature.trusted) return green(`valid, made with the trusted key ${signature.keyId}`);
  return keyGiven
    ? red(`valid, but made with key ${signature.keyId}, not the trusted key`)
    : `valid with its own key ${signature.keyId}; not checked against a trusted key`;
}
