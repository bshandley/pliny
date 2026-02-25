#!/usr/bin/env node
/**
 * Generate fnMap.json - maps API function names to their source code/signature/line
 * Run: node scripts/generate-fn-map.js
 */

const fs = require('fs');
const path = require('path');

const API_FILE = path.join(__dirname, '../client/src/api.ts');
const OUTPUT_FILE = path.join(__dirname, '../server/src/generated/fnMap.json');

function generateFnMap() {
  const source = fs.readFileSync(API_FILE, 'utf-8');
  const lines = source.split('\n');
  const fnMap = {};

  // Match async method definitions in the ApiClient class
  const methodRegex = /^\s+async\s+(\w+)\s*\(([^)]*)\)/;

  let currentMethod = null;
  let methodStartLine = 0;
  let methodLines = [];
  let braceDepth = 0;
  let inMethod = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for method start
    const match = line.match(methodRegex);
    if (match && !inMethod) {
      currentMethod = match[1];
      methodStartLine = lineNum;
      methodLines = [line];
      braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      inMethod = braceDepth > 0 || line.includes('{');

      // Single line method
      if (line.includes('{') && braceDepth === 0) {
        const signature = extractSignature(methodLines.join('\n'));
        fnMap[currentMethod] = {
          name: currentMethod,
          line: methodStartLine,
          signature: signature,
          source: methodLines.join('\n'),
        };
        currentMethod = null;
        methodLines = [];
        inMethod = false;
      }
      continue;
    }

    // Accumulate method body
    if (inMethod && currentMethod) {
      methodLines.push(line);
      braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

      // Method complete
      if (braceDepth <= 0) {
        const signature = extractSignature(methodLines.join('\n'));
        fnMap[currentMethod] = {
          name: currentMethod,
          line: methodStartLine,
          signature: signature,
          source: methodLines.join('\n'),
        };
        currentMethod = null;
        methodLines = [];
        inMethod = false;
      }
    }
  }

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(fnMap, null, 2));
  console.log(`Generated ${OUTPUT_FILE} with ${Object.keys(fnMap).length} functions`);
}

function extractSignature(source) {
  // Extract just the function signature (first line up to opening brace)
  const match = source.match(/async\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/);
  if (match) {
    const name = match[1];
    const params = match[2].trim();
    const returnType = match[3]?.trim() || 'Promise<any>';
    return `async ${name}(${params}): ${returnType}`;
  }
  return source.split('\n')[0];
}

generateFnMap();
