import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Test accounts for `login`. Values are read here and typed straight into the page:
 * they never go back to the model, into meta.json or into logs. Tools only ever
 * return account *names* and where they came from.
 */
export interface Account {
  username: string;
  password: string;
}

type AccountMap = Record<string, Account>;

export interface EnvFileRef {
  /** Path relative to the project, e.g. `.env.example` or `prisma/.env.seed`. */
  envFile: string;
  userKey: string;
  passKey: string;
}

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

/** JSON.parse errors quote the input, which holds passwords here: name the source only. */
function parseAccounts(text: string, source: string): AccountMap {
  try {
    return JSON.parse(text) as AccountMap;
  } catch {
    throw new Error(`JSON invalide dans ${source} (contenu masqué).`);
  }
}

function readJson(file: string): AccountMap {
  if (!fs.existsSync(file)) return {};
  const data = parseAccounts(fs.readFileSync(file, "utf8"), file);
  return Object.fromEntries(
    Object.entries(data).filter(([, a]) => a && typeof a.username === "string" && typeof a.password === "string"),
  );
}

function sources(projectDir: string): { source: string; accounts: () => AccountMap }[] {
  return [
    {
      source: "env DEMO_AGENT_ACCOUNTS",
      accounts: () => (process.env.DEMO_AGENT_ACCOUNTS ? parseAccounts(process.env.DEMO_AGENT_ACCOUNTS, "DEMO_AGENT_ACCOUNTS") : {}),
    },
    { source: ".demo-agent/accounts.json (projet)", accounts: () => readJson(path.join(projectDir, ".demo-agent", "accounts.json")) },
    { source: "~/.demo-agent/accounts.json", accounts: () => readJson(path.join(os.homedir(), ".demo-agent", "accounts.json")) },
  ];
}

export function listAccounts(projectDir: string): { name: string; source: string }[] {
  const seen = new Set<string>();
  const out: { name: string; source: string }[] = [];
  for (const s of sources(projectDir)) {
    for (const name of Object.keys(s.accounts())) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, source: s.source });
    }
  }
  return out;
}

export function resolveAccount(projectDir: string, ref: { account?: string } & Partial<EnvFileRef>): Account {
  if (ref.envFile && ref.userKey && ref.passKey) {
    const file = path.resolve(projectDir, ref.envFile);
    if (!file.startsWith(path.resolve(projectDir))) throw new Error("envFile doit rester dans le projet.");
    if (!fs.existsSync(file)) throw new Error(`Fichier introuvable : ${ref.envFile}`);
    const env = parseDotenv(fs.readFileSync(file, "utf8"));
    const username = env[ref.userKey];
    const password = env[ref.passKey];
    if (!username || !password) throw new Error(`Clés ${ref.userKey} / ${ref.passKey} absentes ou vides dans ${ref.envFile}.`);
    return { username, password };
  }
  for (const s of sources(projectDir)) {
    const all = s.accounts();
    const name = ref.account ?? Object.keys(all)[0];
    if (name && all[name]) return all[name];
  }
  throw new Error(
    "Aucun compte de test trouvé. Ajoute .demo-agent/accounts.json dans le projet " +
      '({"admin": {"username": "...", "password": "..."}}) ou passe envFile + userKey + passKey.',
  );
}
