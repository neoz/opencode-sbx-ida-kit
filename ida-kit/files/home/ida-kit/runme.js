// Made specifically for IDA 9.4 beta1
// May not work for other versions of this software including future ones
//
// Usage:
//   node runme.js [options] [path]
//
//   path                 IDA install directory (or a single library file).
//                        Default: the directory this script lives in.
//
// Options:
//   -p, --path <path>    same as the positional path
//   -r, --recursive      also look for the libraries in subdirectories
//   -o, --out <file>     write the license to this file instead of <path>/idapro.hexlic
//       --home           also write the license to ~/.idapro/idapro.hexlic
//       --no-license     skip license generation
//       --no-patch       skip binary patching
//   -n, --dry-run        show what would happen, write nothing
//   -l, --list           only list the files that would be patched
//   -s, --strict         exit non-zero when nothing was patched
//   -h, --help           show this help
//
// Examples:
//   node runme.js /opt/ida-pro
//   node runme.js --path "C:\Program Files\IDA Professional 9.4" --home
//   node runme.js -n -l /opt/ida-pro

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LIB_NAMES = [
    'ida.dll', 'ida32.dll',
    'libida.so', 'libida32.so',
    'libida.dylib', 'libida32.dylib',
];

// --- Helper funcs ---
//recursive sorting into json string
function sort(obj) {
    if (Array.isArray(obj)) {
        return '[' + obj.map(sort).join(',') + ']';
    } else if (obj && typeof obj === 'object' && obj !== null) {
        var keys = Object.keys(obj).sort();
        return '{' + keys.map(k => '"' + k + '":' + sort(obj[k])).join(',') + '}';
    } else {
        return JSON.stringify(obj);
    }
}

const cModulus   = Buffer.from("3f0307607fed562fd5a163adc40fcc603373caa28414e64cdc4552a555b13ad4b3ad0a812800a03195300fd71634b90edb0d69ea710efebb2b0b9e72da2effb149de70bcbfa94b86af01ce455dbbd5fa987207651c7b60c2e4cafd0654188d98c30f64dc084d8547f0ac32db91124af82b3b15bf922a31f1d5e332f27615cea7", "hex");
const privateKey = Buffer.from("8b3f5fdfad7f87239734c530e2ecebeb4fa48d79518756c15fd54636801cf7ea6367100566bf8b52b16bec05258d8426ea94c15841ab2d37802c07349df4c208584e86d25a6bfb82966cb2ddcd3d654e9994e814ca470577362a937cc984e404a0b68d173aab3180130118e1b03ed209a9d8757560a85a3c9b0d3380e7907c4f", "hex");

const V54 = 127;
const V56 = 95;
const PADKEY = Buffer.from("e2a7c300dfcc777f89b57500d8151c7fb1d97b3f9f170393311234ceeb9e377ae2a7c300dfcc777f89b57500d8151c7fb1d97b3f9f170393311234ceeb9e377ae2a7c300dfcc777f89b57500d8151c7fb1d97b3f9f170393311234ceeb9e377ae2a7c300dfcc777f89b57500d8151c7fb1d97b3f9f170393311234ceeb9e37", "hex");

// --- Patch pattern ---
const SEARCH  = Buffer.from("29f4481f796f9f66f2ff13cc4ab5b54f60845db603ba2c0bac8a9bc4b6cbdefc5c62bfc2f5ee850ac45ea97ad347e8b56dba5085af8c8aad9cc2ec626ca78a068006d658f68651da31a0a77c65a70ed73a40d53b08edd403c095aa0bcffa52f313ebcacaaa2ce5024a4e2b9aa70fc6092f38ae094d71e43f7690b5ddd3e9e4f7", "hex");
const REPLACE = Buffer.from("a107b71c8a08ba5350934f7cf6e81be3a24dc2e35f7200d80cbd70b37ed6811dd2146d3cb7e20ad19b2544c0ef14c5c66ffbbdf226ec3f3d544c04385303ca4a7179299340022f5d50948bcf8a60307e2c196329e51a5296dc419e40fef3ef7c6f015a09ebd979e79615338985643e666c14897f9f597e11f44341f496d56861", "hex");

function encrypt(message) {
    let modulusBuf = 0n;
    for (let i = cModulus.length - 1; i >= 0; i--)
        modulusBuf = (modulusBuf << 8n) + BigInt(cModulus[i]);

    let keyBuf = 0n;
    for (let i = privateKey.length - 1; i >= 0; i--)
        keyBuf = (keyBuf << 8n) + BigInt(privateKey[i]);

    var reversed = Buffer.from(message).reverse();

    let msgBuf = 0n;
    for (let i = reversed.length - 1; i >= 0; i--)
        msgBuf = (msgBuf << 8n) + BigInt(reversed[i]);

    let base = msgBuf % modulusBuf, exponent = keyBuf, modulus = modulusBuf, encryptedBigInt = 1n;
    while (exponent > 0n) {
        if (exponent % 2n === 1n)
            encryptedBigInt = (encryptedBigInt * base) % modulus;
        exponent >>= 1n; base = (base * base) % modulus;
    }

    var bytes = [];
    for (let buffer = encryptedBigInt; buffer > 0n; buffer >>= 8n) bytes.push(Number(buffer & 0xFFn));
    return Buffer.from(bytes);
}

function sign(payload) {
  var dataStr = sort({ payload });
  var hash = crypto.createHash('sha256').update(dataStr).digest(); // 32 bytes

  var U = Buffer.alloc(V54, 0);
  hash.copy(U, V56);
  var block = Buffer.alloc(V54);
  for (var i = 0; i < V54; i++) block[i] = U[i] ^ PADKEY[i];
  if (block[0] === 0) block[0] ^= 1;

  var sig = encrypt(block);
  var out = Buffer.alloc(128, 0);
  sig.copy(out, 0);
  return out.toString('hex').toUpperCase();
}

function buildLicense(productVersion, holder) {
    const license = {
        header: { version: 1 },
        payload: {
            name: holder,
            email: 'rea-team@hex-rays.com',
            licenses: [
                {
                    description: 'license',
                    edition_id: 'ida-pro',
                    id: '14-0000-FFFF-88',
                    license_type: 'named',
                    product: 'IDA',
                    seats: 1,
                    start_date: '2024-08-10 00:00:00',
                    end_date: '2033-12-31 23:59:59',
                    issued_on: '2025-07-20 00:00:00',
                    owner: holder,
                    product_id: 'IDAPRO',
                    product_version: productVersion,
                    add_ons: [],
                    features: [],
                }
            ],
        },
    };

    var addons = [ //update as needed, doesnt include cloud addons
        'LUMINA', 'TEAMS',
        'HEXX86', 'HEXX64', 'HEXARM', 'HEXARM64',
        'HEXMIPS', 'HEXMIPS64', 'HEXPPC', 'HEXPPC64',
        'HEXRV', 'HEXRV64', 'HEXARC', 'HEXARC64',
        'HEXV850', 'HEXDALVIK', 'HEXTRICORE', 'HEXQDSP6',
        'MALWARE'
    ];

    addons.forEach((addon, i) => {
        license.payload.licenses[0].add_ons.push({
            id: `48-1337-B00B-${String(i + 1).padStart(2, '0')}`,
            code: addon,
            owner: license.payload.licenses[0].id,
            start_date: '2025-07-20 00:00:00',
            end_date: '2033-12-31 23:59:59',
        });
    });

    license.signature = sign(license.payload);
    return license;
}

// --- CLI ---
function usage() {
    const lines = [
        '',
        'IDA license generator + binary patcher',
        '',
        'Usage: node runme.js [options] [path]',
        '',
        '  path                IDA install directory, or a single library file.',
        '                      Default: the directory containing this script.',
        '',
        'Options:',
        '  -p, --path <path>   same as the positional path',
        '  -r, --recursive     also search subdirectories for the libraries',
        '  -o, --out <file>    write the license to <file> instead of <path>/idapro.hexlic',
        '      --home          also write the license to ~/.idapro/idapro.hexlic',
        '      --no-license    skip license generation',
        '      --no-patch      skip binary patching',
        '  -n, --dry-run       show what would happen, write nothing',
        '  -l, --list          only list the files that would be patched',
        '  -s, --strict        exit non-zero when nothing was patched',
        '  -h, --help          show this help',
        '',
        'Examples:',
        '  node runme.js /opt/ida-pro',
        '  node runme.js -p "C:\\Program Files\\IDA Professional 9.4" --home',
        '  node runme.js -n -l /opt/ida-pro',
        '',
    ];
    console.log(lines.join('\n'));
}

function fail(message) {
    console.error(`error: ${message}`);
    console.error('run "node runme.js --help" for usage');
    process.exit(1);
}

function parseArgs(argv) {
    const opts = {
        root: null,
        recursive: false,
        out: null,
        home: false,
        license: true,
        patch: true,
        dryRun: false,
        list: false,
        strict: false,
        help: false,
    };
    const positional = [];

    const value = (flag, i) => {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('-')) fail(`${flag} requires a value`);
        return v;
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-h' || arg === '--help') opts.help = true;
        else if (arg === '-p' || arg === '--path') { opts.root = value(arg, i); i++; }
        else if (arg.startsWith('--path=')) opts.root = arg.slice('--path='.length);
        else if (arg === '-o' || arg === '--out') { opts.out = value(arg, i); i++; }
        else if (arg.startsWith('--out=')) opts.out = arg.slice('--out='.length);
        else if (arg === '-r' || arg === '--recursive') opts.recursive = true;
        else if (arg === '--home') opts.home = true;
        else if (arg === '--no-license') opts.license = false;
        else if (arg === '--no-patch') opts.patch = false;
        else if (arg === '-n' || arg === '--dry-run') opts.dryRun = true;
        else if (arg === '-l' || arg === '--list') { opts.list = true; opts.dryRun = true; }
        else if (arg === '-s' || arg === '--strict') opts.strict = true;
        else if (arg === '--') positional.push(...argv.slice(i + 1));
        else if (arg.startsWith('-')) fail(`unknown option ${arg}`);
        else positional.push(arg);
    }

    if (positional.length > 1) fail('too many paths given (pass a single path)');
    if (positional.length === 1) {
        if (opts.root !== null) fail('path given twice (positional and --path)');
        opts.root = positional[0];
    }
    return opts;
}

function resolveRoot(root) {
    const abs = path.resolve(root === null ? __dirname : root);
    let st;
    try {
        st = fs.statSync(abs);
    } catch (err) {
        fail(`path not found: ${abs}`);
    }
    return { abs, isFile: st.isFile(), isDir: st.isDirectory() };
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'python', 'idalib', 'plugins', 'sig', 'til', 'themes', 'cfg']);

function walk(dir, depth, out, seen) {
    if (depth < 0) return;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
            walk(full, depth - 1, out, seen);
        } else if (entry.isFile() && LIB_NAMES.includes(entry.name) && !seen.has(full)) {
            seen.add(full);
            out.push(full);
        }
    }
}

function resolveTargets(rootInfo, recursive) {
    if (rootInfo.isFile) return [rootInfo.abs];

    const found = [];
    const seen = new Set();
    for (const name of LIB_NAMES) {
        const full = path.join(rootInfo.abs, name);
        try {
            if (fs.statSync(full).isFile()) {
                seen.add(full);
                found.push(full);
            }
        } catch (err) { /* not present */ }
    }
    if (recursive) walk(rootInfo.abs, 3, found, seen);
    return found;
}

function countOccurrences(buf, pattern) {
    let n = 0;
    let idx = buf.indexOf(pattern);
    while (idx !== -1) {
        n++;
        idx = buf.indexOf(pattern, idx + pattern.length);
    }
    return n;
}

function patchFile(file, search, replace, dryRun) {
    let buf;
    try {
        buf = fs.readFileSync(file);
    } catch (err) {
        return { file, status: 'error', count: 0, message: err.message };
    }

    const offsets = [];
    let idx = buf.indexOf(search);
    while (idx !== -1) {
        offsets.push(idx);
        idx = buf.indexOf(search, idx + search.length);
    }

    if (offsets.length === 0) {
        const already = countOccurrences(buf, replace);
        return { file, status: already > 0 ? 'already-patched' : 'not-found', count: already };
    }

    if (replace.length !== search.length) {
        console.warn(`  warning: replacement is ${replace.length} bytes, pattern is ${search.length} bytes`);
    }

    if (dryRun) {
        return { file, status: 'would-patch', count: offsets.length };
    }

    for (const offset of offsets) buf.set(replace, offset);
    try {
        fs.writeFileSync(file, buf);
    } catch (err) {
        return { file, status: 'error', count: offsets.length, message: err.message };
    }
    return { file, status: 'patched', count: offsets.length };
}

function writeLicense(targetDir, opts, licenseJson) {
    let out;
    if (opts.out) {
        out = path.resolve(opts.out);
    } else {
        out = path.join(targetDir, 'idapro.hexlic');
    }

    const destinations = [out];
    if (opts.home) destinations.push(path.join(os.homedir(), '.idapro', 'idapro.hexlic'));

    for (const dest of destinations) {
        if (opts.dryRun) {
            console.log(`[dry-run] would write license to ${dest}`);
            continue;
        }
        try {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, licenseJson);
            console.log(`License written to ${dest}`);
        } catch (err) {
            return { ok: false, message: `${dest}: ${err.message}` };
        }
    }
    return { ok: true };
}

// --- Main ---
function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        usage();
        return 0;
    }

    const rootInfo = resolveRoot(opts.root);
    const targetDir = rootInfo.isFile ? path.dirname(rootInfo.abs) : rootInfo.abs;

    console.log(`Target : ${rootInfo.abs}`);
    console.log(`Mode   : ${opts.dryRun ? 'dry-run (no writes)' : 'write'}`);
    console.log('');

    if (opts.license) {
        const license = buildLicense('9.5', 'auth');
        const licenseJson = sort(license);
        const result = writeLicense(targetDir, opts, licenseJson);
        if (!result.ok) {
            console.error(`error: could not write license: ${result.message}`);
            return 1;
        }
    } else {
        console.log('License: skipped (--no-license)');
    }

    if (!opts.patch) {
        console.log('Patching: skipped (--no-patch)');
        return 0;
    }

    const targets = resolveTargets(rootInfo, opts.recursive);
    if (targets.length === 0) {
        console.error(`No patchable library found in ${rootInfo.abs}`);
        console.error(`Looked for: ${LIB_NAMES.join(', ')}${opts.recursive ? ' (recursive)' : ''}`);
        console.error('Try --recursive, or pass the directory that contains the libraries.');
        return opts.strict ? 2 : 0;
    }

    console.log(`${opts.list ? 'Found' : 'Patching'} ${targets.length} file(s):`);
    const results = targets.map(file => patchFile(file, SEARCH, REPLACE, opts.dryRun));

    let patched = 0;
    for (const r of results) {
        const rel = path.relative(process.cwd(), r.file) || r.file;
        switch (r.status) {
            case 'patched':
            case 'would-patch':
                patched++;
                console.log(`  ${r.status === 'patched' ? 'patched' : 'would patch'}  ${rel}  (${r.count} occurrence${r.count === 1 ? '' : 's'})`);
                break;
            case 'already-patched':
                console.log(`  already   ${rel}  (pattern already replaced, skipped)`);
                break;
            case 'not-found':
                console.log(`  no match  ${rel}  (version mismatch? not patched)`);
                break;
            default:
                console.error(`  error     ${rel}  ${r.message}`);
                console.error('            elevated permissions given?');
                break;
        }
    }

    console.log('');
    if (patched > 0) {
        console.log(`Done: ${patched} file(s) ${opts.dryRun ? 'would be patched' : 'patched'}.`);
    } else {
        console.log('Nothing patched.');
    }

    if (os.platform() === 'darwin') {
        const dylibs = results.filter(r => r.file.endsWith('.dylib'));
        if (dylibs.length > 0) {
            console.log('');
            console.log('You will have to re-sign both "libida32.dylib" and "libida.dylib" or else IDA will not start up:');
            for (const d of dylibs) {
                console.log(` # codesign --verbose --force --deep --sign - "${path.basename(d.file)}"`);
            }
            console.log('');
            console.log('Alternatively you can disable Security Features like Gatekeeper to avoid this restriction, however I do not recommend doing this.');
        }
    }

    if (patched === 0 && opts.strict) return 2;
    return 0;
}

process.exitCode = main();
