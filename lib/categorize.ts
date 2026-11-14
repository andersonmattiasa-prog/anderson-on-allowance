import type { Vault } from './types';
import { normText } from './util';

// Checked in order; the first category with a whole-word match wins.
const KEYWORDS: [string, string[]][] = [
  ['income', ['salary', 'salaire', 'payroll', 'wonka', 'loon', 'wages', 'stipend', 'internship']],
  ['invest', ['wealthsimple', 'odlum', 'odlum brown', 'questrade', 'tfsa', 'fhsa', 'rrsp']],
  ['transfer', ['payment thank you', 'payment received', 'payment from', 'paiement recu', 'autopay', 'auto pay', 'pre authorized payment', 'balance transfer', 'transfer to', 'transfer from', 'sent money to', 'received money from', 'e transfer', 'interac', 'top up', 'topup', 'converted', 'conversion', 'mb transfer', 'credit card payment']],
  ['rent', ['cohabs', 'rent', 'loyer', 'huur']],
  ['subscriptions', ['netflix', 'spotify', 'apple com bill', 'apple com', 'icloud', 'disney plus', 'disney', 'youtube premium', 'youtube', 'google one', 'google storage', 'chatgpt', 'openai', 'prime video', 'amazon prime', 'audible', 'adobe', 'patreon', 'crunchyroll', 'dropbox', 'notion', 'duolingo', 'claude ai', 'anthropic', 'microsoft 365', 'strava', 'nyt', 'medium']],
  ['phone', ['proximus', 'orange belgium', 'orange', 'telenet', 'mobile vikings', 'scarlet', 'voo', 'fido', 'rogers', 'telus', 'koodo', 'freedom mobile', 'public mobile', 'shaw', 'lycamobile', 'base', 'airalo', 'holafly']],
  ['takeaway', ['uber eats', 'ubereats', 'deliveroo', 'takeaway com', 'takeaway', 'just eat', 'mcdonalds', 'mcdonald', 'mc donalds', 'kfc', 'burger king', 'quick', 'subway', 'dominos', 'domino', 'five guys', 'pizza hut', 'exki', 'panos', 'o tacos', 'otacos', 'pita', 'kebab', 'frituur', 'friterie', 'fritkot', 'wendys', 'taco bell', 'chipotle', 'a w', 'popeyes', 'too good to go', 'toogoodtogo']],
  ['groceries', ['delhaize', 'ad delhaize', 'colruyt', 'okay', 'carrefour', 'carrefour express', 'carrefour market', 'aldi', 'lidl', 'albert heijn', 'spar', 'intermarche', 'cora', 'bio planet', 'franprix', 'monoprix', 'match', 'smatch', 'grocery', 'epicerie', 'supermarche', 'supermarket', 'night shop', 'nightshop', 'sobeys', 'safeway', 'save on foods', 'superstore', 'loblaws', 'no frills', 'iga', 'costco', 'walmart', 'whole foods', 'thrifty foods', 'urban fare', 'kelly fresh', 'picard']],
  ['travel', ['eurostar', 'thalys', 'sncf', 'ouigo', 'trainline', 'flixbus', 'blablacar', 'ryanair', 'brussels airlines', 'easyjet', 'air canada', 'westjet', 'klm', 'lufthansa', 'air france', 'vueling', 'transavia', 'wizz', 'booking com', 'booking', 'airbnb', 'hotel', 'hostel', 'expedia', 'hostelworld', 'ibis', 'novotel', 'meininger', 'generator', 'deutsche bahn', 'db bahn']],
  ['transport', ['stib', 'mivb', 'sncb', 'nmbs', 'de lijn', 'tec', 'uber', 'bolt', 'heetch', 'villo', 'lime', 'dott', 'tier', 'poppy', 'cambio', 'taxi', 'metro', 'ratp', 'navigo', 'compass', 'translink', 'evo', 'modo', 'parking', 'q park', 'interparking', 'shell', 'esso', 'petro canada', 'chevron', 'total energies', 'totalenergies']],
  ['cafes', ['cafe', 'caffe', 'coffee', 'koffie', 'starbucks', 'tim hortons', 'costa', 'espresso', 'barista', 'boulangerie', 'bakery', 'bakkerij', 'patisserie', 'le pain quotidien', 'tea', 'matcha', 'croissant', 'waffle', 'gaufre']],
  ['eating-out', ['restaurant', 'resto', 'brasserie', 'bistro', 'bistrot', 'pizzeria', 'pizza', 'trattoria', 'osteria', 'sushi', 'ramen', 'pho', 'thai', 'grill', 'steakhouse', 'taverne', 'tavern', 'diner', 'kitchen', 'cantina', 'izakaya', 'dim sum', 'poke', 'brunch', 'eatery', 'burger', 'noodle', 'tapas', 'bagel']],
  ['health', ['pharmacie', 'pharmacy', 'apotheek', 'multipharma', 'shoppers drug mart', 'london drugs', 'doctor', 'medecin', 'dentist', 'dentiste', 'clinic', 'clinique', 'hopital', 'hospital', 'physio', 'gym', 'basic fit', 'jims', 'fitness', 'yoga', 'optique', 'optician']],
  ['personal', ['kruidvat', 'di', 'ici paris', 'douglas', 'sephora', 'hairdresser', 'coiffeur', 'coiffure', 'barber', 'barbier', 'salon', 'rituals', 'lush', 'nails']],
  ['shopping', ['amazon', 'zalando', 'h m', 'hm', 'zara', 'uniqlo', 'primark', 'ikea', 'hema', 'action', 'fnac', 'mediamarkt', 'media markt', 'decathlon', 'inno', 'bershka', 'pull bear', 'mango', 'cos', 'vinted', 'bol com', 'coolblue', 'apple store', 'best buy', 'winners', 'aritzia', 'lululemon', 'nike', 'adidas', 'jd sports', 'foot locker', 'urban outfitters', 'brico', 'gamma', 'aliexpress', 'shein', 'temu']],
  ['entertainment', ['cinema', 'kinepolis', 'ugc', 'cineplex', 'theatre', 'theater', 'museum', 'musee', 'concert', 'ticketmaster', 'eventbrite', 'steam', 'playstation', 'xbox', 'nintendo', 'bar', 'pub', 'club', 'bowling', 'escape', 'beer', 'biere', 'delirium']],
  ['gifts', ['gift', 'cadeau', 'flowers', 'fleuriste', 'bloemen', 'florist']],
];

const COMPILED = KEYWORDS.map(([cat, words]) => [cat, words.map(normText)] as const);

export function keywordCategory(text: string): string | null {
  const n = normText(text);
  for (const [cat, words] of COMPILED) for (const w of words) if (w.trim() && n.includes(w)) return cat;
  return null;
}

/** Stable short key for a merchant, used for learned rules. */
const GENERIC = /^\s*(card transaction of|purchase at|pos purchase|debit card purchase|payment to|achat|paiement)\s+/;
export function merchantKey(merchant: string): string {
  return normText(merchant)
    .replace(GENERIC, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 1 && !/\d/.test(w))
    .slice(0, 3)
    .join(' ');
}

export function categorize(v: Vault, merchant: string, description = '', amount = -1): string {
  const key = merchantKey(merchant);
  const n = normText(`${merchant} ${description}`);
  for (const r of v.rules) {
    if (r.match && (key === r.match || n.includes(` ${r.match} `)) && v.categories.some((c) => c.id === r.category)) return r.category;
  }
  const k = keywordCategory(`${merchant} ${description}`);
  if (k && v.categories.some((c) => c.id === k)) {
    if (k === 'income' && amount < 0) return 'other';
    return k;
  }
  return amount > 0 ? 'transfer' : 'other';
}

/** Learn "this merchant → category" and apply it to past transactions that weren't set by hand. */
export function learnRule(v: Vault, merchant: string, category: string): number {
  const key = merchantKey(merchant);
  if (!key) return 0;
  v.rules = v.rules.filter((r) => r.match !== key);
  v.rules.unshift({ match: key, category });
  v.deleted = v.deleted.filter((d) => d !== `rule:${key}`);
  let changed = 0;
  for (const t of v.transactions) {
    if (merchantKey(t.merchant) === key && t.category !== category && !t.manualCat) {
      t.category = category;
      t.updatedAt = Date.now();
      changed++;
    }
  }
  return changed;
}

const STOP = new Set(['the', 'and', 'les', 'des', 'sarl', 'sprl', 'srl', 'bv', 'nv', 'sa', 'inc', 'ltd', 'llc', 'gmbh', 'bxl', 'bruxelles', 'brussels', 'brussel', 'paris', 'www', 'com', 'store', 'shop', 'ca', 'be', 'fr']);
const tokens = (s: string) => normText(s).trim().split(' ').filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));

export function similarMerchant(a: string, b: string): boolean {
  const A = tokens(a);
  const B = tokens(b);
  const setB = new Set(B);
  if (A.some((t) => setB.has(t))) return true;
  const ja = A.join('');
  const jb = B.join('');
  return ja.length >= 4 && jb.length >= 4 && (ja.includes(jb) || jb.includes(ja));
}
