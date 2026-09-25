/*
 * Warengruppen und Laufweg: ordnet jeden Artikel einer Warengruppe zu und sortiert das Sortiment
 * so, als würde man durch den Laden gehen – Gruppen in Laufweg-Reihenfolge, Artikel innerhalb
 * einer Gruppe zufällig gemischt (reproduzierbar über einen Zufallswert "seed").
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Warengruppen = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Standard-Laufweg: Frische am Eingang, Kühlregal, Trockensortiment, Getränke, Tiefkühl vor der Kasse.
  const GRUPPEN = [
    { id: 'obst', name: 'Obst & Gemüse' },
    { id: 'brot', name: 'Brot & Backwaren' },
    { id: 'milch', name: 'Milch & Milchgetränke' },
    { id: 'joghurt', name: 'Joghurt' },
    { id: 'dessert', name: 'Quark & Desserts' },
    { id: 'butter', name: 'Butter, Sahne & Margarine' },
    { id: 'kaese', name: 'Käse' },
    { id: 'wurst', name: 'Wurst & Aufschnitt' },
    { id: 'feinkost', name: 'Feinkost & Salate' },
    { id: 'fleisch', name: 'Fleisch & Geflügel' },
    { id: 'hmilch', name: 'H-Milch & Kondensmilch' },
    { id: 'konserven', name: 'Konserven & Fertiggerichte' },
    { id: 'nudeln', name: 'Nudeln, Reis & Backzutaten' },
    { id: 'saucen', name: 'Saucen, Fonds & Gewürze' },
    { id: 'fruehstueck', name: 'Frühstück & Brotaufstrich' },
    { id: 'kaffee', name: 'Kaffee & Tee' },
    { id: 'snacks', name: 'Snacks & Nüsse' },
    { id: 'drogerie', name: 'Drogerie & Haushalt' },
    { id: 'getraenke', name: 'Getränke' },
    { id: 'tk', name: 'Tiefkühl' },
    { id: 'sonstiges', name: 'Sonstiges' },
  ];
  const BY_ID = new Map(GRUPPEN.map((g) => [g.id, g]));
  const DEFAULT_ORDER = GRUPPEN.map((g) => g.id);

  /** Warengruppe (id) zu einem Namen oder einer id, auch für selbst angelegte Gruppen; sonst null. */
  function idOf(nameOrId) {
    const key = String(nameOrId || '').trim().toLowerCase();
    if (!key) return null;
    const g = GRUPPEN.find((x) => x.id === key || x.name.toLowerCase() === key);
    return g ? g.id : null;
  }

  /**
   * Eigene Warengruppe anlegen (z. B. "Aktion"); gibt die id zurück, bei schon vorhandenem Namen dessen id.
   * Eigene Gruppen stehen im Standard-Laufweg vor "Sonstiges" und lassen sich wie alle anderen verschieben.
   */
  function register(name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean) return null;
    const known = idOf(clean);
    if (known) return known;
    const slug = clean
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // übrige Akzente weg
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const base = 'x-' + (slug || 'gruppe');
    let id = base;
    for (let n = 2; BY_ID.has(id); n++) id = base + '-' + n;
    const g = { id, name: clean, eigen: true };
    GRUPPEN.splice(GRUPPEN.length - 1, 0, g); // vor "Sonstiges"
    DEFAULT_ORDER.splice(DEFAULT_ORDER.length - 1, 0, id);
    BY_ID.set(id, g);
    return id;
  }

  // 1) Kategorie aus der CSV (wo vorhanden) – erste passende Regel gewinnt.
  const KATEGORIE_REGELN = [
    ['drogerie', /drogerie|haushalt|tiernahrung/],
    ['getraenke', /getränk|bier|wein|saft|schorle|limonade|wasser/],
    ['tk', /tiefkühl|\btk\b/],
    ['konserven', /konserve|fertiggericht|eintopf/],
    ['saucen', /sauce|soße|ketchup|würz|fond|suppe|feinkost/],
    ['nudeln', /nudel|pasta|reis\b|backzutat|zucker|mehl|trockensortiment/],
    ['kaffee', /kaffee|\btee\b/],
    ['fruehstueck', /aufstrich|frühstück|müsli/],
    ['snacks', /snack|chips|nüsse|nuss|riegel|süßwaren|gebäck/],
    ['obst', /obst|gemüse/],
    ['brot', /\bbrot\b|backwaren|brötchen/],
    ['kaese', /käse/],
    ['wurst', /wurst|aufschnitt/],
    ['fleisch', /fleisch|geflügel/],
    ['milch', /molkerei|milch/],
  ];

  // 2) Produktname – Reihenfolge ist wichtig (z. B. Leberkäse vor Käse, Buttermilch vor Butter).
  const NAME_REGELN = [
    ['tk', /tiefkühl|pizza(?!käse)|schlemmerfilet|fischstäbchen|\beis\b|eiscreme|pommes/],
    ['getraenke', /\bbier\b|pils|export|saft\b|schorle|limonade|eistee|mineralwasser|\bcola\b|nektar/],
    ['milch', /espresso|macchiato|cappuccino|latte\b|milchkaffee/],
    ['hmilch', /\bh-|haltbar|kondensmilch|kaffeesahne|kaffeeweißer/],
    ['konserven', /eintopf|topf\b|konserve|\bdose\b/],
    ['konserven', /sardine|thunfisch|makrele|bückling|hering/],
    ['feinkost', /kartoffelsalat|nudelsalat/],
    ['dessert', /panna cotta|pudding|dessert|milchreis|grießbrei|mousse/],
    ['saucen', /sauce|soße|mayonnaise|ketchup|senf|dressing|\bfond\b|brühe|zitronello|essig/],
    ['wurst', /leberkäse|fleischkäse/],
    ['fleisch', /leberkäsbrät|\bbrät\b|\broh\b/],
    ['kaese', /käse|gouda|mozzarella|maasdamer|emmentaler|tilsiter|limburger|\bfeta\b|camembert|parmesan|edamer/],
    ['feinkost', /fleischsalat|salat\b|antipasti|hummus|\bdip\b/],
    ['fleisch', /hackfleisch|gulasch|steak|hähnchen|puten|lachsfilet|geschnetzeltes|schenkel|beinscheiben|innenfilet|kotelett|schnitzel|burger|braten\b/],
    ['wurst', /wurst|würstchen|schinken|lyoner|salami|mortadella|kasseler|aufschnitt|pastete|pfefferbeisser|prosciutto|speck\b|cabanossi/],
    ['dessert', /quark|protein|genussmoment/],
    ['joghurt', /joghurt|skyr/],
    ['milch', /milch|kefir|\blassi\b|drink|kakao|molke|\beier\b/],
    ['butter', /butter|margarine|sahne|schmand|crème|creme/],
    ['nudeln', /nudel|spaghetti|lasagne|tortiglioni|fusilli|farfalle|linguine|maccheroni|penne|\breis\b|mehl|zucker|backkakao/],
    ['kaffee', /kaffee|café|\bcafe\b|mocca|mokka|tee\b|teebeutel|kaffeepads|kaffeekapseln/],
    ['fruehstueck', /aufstrich|marmelade|konfitüre|honig|müsli|cornflakes|nougat/],
    ['snacks', /chips|knabber|nüsse|erdnuss|mandeln|cashew|studentenfutter|riegel|gebäck|salzstangen|flips|keks|schokolade/],
    ['konserven', /mais\b|bohnen|erbsen|champignon|ananas|püree|fruchtmus|tomaten/],
  ];

  // 0) Kategorien aus Open Food Facts (categories_tags, z. B. "en:ground-coffees") – verlässlicher als der Name.
  //    Die Tags sind hierarchisch (allgemein → speziell), deshalb zählt die Reihenfolge der Regeln.
  const TAG_REGELN = [
    ['tk', /frozen|ice-creams/],
    ['kaffee', /coffee|^en:teas|tea-bags|herbal-teas|green-teas|black-teas|infusions/],
    ['fruehstueck', /breakfast-cereals|muesli|spreads|jams|marmalades|honeys|cocoa-powders/],
    ['dessert', /quarks|fromages-blancs|puddings|rice-puddings|semolina-puddings/],
    ['joghurt', /yogurts|yoghurts|skyr/],
    ['kaese', /cheese/],
    ['hmilch', /uht|long-life|sterili[sz]ed-milks|condensed-milks|evaporated-milks|coffee-creamers|coffee-whiteners/],
    ['butter', /butters|margarines|^en:creams|sour-creams|creme-fraiche|whipping-creams/],
    ['milch', /^en:milks$|^en:whole-milks|^en:semi-skimmed-milks|^en:skimmed-milks|buttermilks|kefirs|dairy-drinks|milk-drinks|milk-substitutes|plant-based-milk|flavoured-milks/],
    ['dessert', /dairy-desserts|^en:desserts/],
    ['konserven', /canned|ready-meals|^en:soups|meals-with/],
    ['wurst', /sausages|hams|salami|cold-cuts|prepared-meats|pates/],
    ['fleisch', /^en:meats|poultr|chicken|beef|pork|turkey|minced|fishes|seafood|salmons/],
    ['feinkost', /salads|dips|hummus|spreadable-salads/],
    ['nudeln', /pastas|noodles|^en:rices|flours|sugars|baking|gnocchi/],
    ['saucen', /sauces|condiments|spices|^en:oils|vegetable-oils|olive-oils|vinegars|broths|bouillon|mayonnaises|ketchup|mustards|salts/],
    ['snacks', /snacks|chips|crisps|^en:nuts|chocolates|candies|confectioner|biscuits|cookies|bars|popcorn|pretzels|dried-fruits/],
    ['brot', /breads|pastries|cakes|viennoiseries|rusks|toasts/],
    ['getraenke', /beverages|waters|juices|nectars|sodas|beers|wines|spirits|lemonades|iced-teas/],
    ['obst', /^en:fresh-fruits|^en:fresh-vegetables|^en:fruits$|^en:vegetables$|^en:potatoes|^en:dates|^en:apples|^en:bananas|^en:tomatoes|herbs/],
  ];

  function fromTags(tags) {
    const list = (Array.isArray(tags) ? tags : []).map((t) => String(t).toLowerCase());
    if (!list.length) return null;
    for (const [id, re] of TAG_REGELN) if (list.some((t) => re.test(t))) return id;
    return null;
  }

  // 3) Marke als letzter Anhaltspunkt.
  const MARKE_REGELN = [
    ['fleisch', /gut ponholz/],
    ['snacks', /clarky/],
    ['saucen', /papa joe/],
    ['nudeln', /pasta rey/],
    ['konserven', /pot[eé]|beste ernte/],
    ['getraenke', /stardrink|schloss/],
  ];

  const first = (rules, text) => {
    for (const [id, re] of rules) if (re.test(text)) return id;
    return null;
  };

  /** Warengruppe (id) eines Artikels; eine Spalte "warengruppe" in der CSV hat Vorrang, dann Open-Food-Facts-Kategorien. */
  function classify(item) {
    const explicit = idOf(item.warengruppe);
    if (explicit) return explicit;
    // Artikel aus Open Beauty Facts sind Drogerieartikel.
    if (/beauty facts/i.test(String(item.quelle || ''))) return 'drogerie';
    const kategorie = String(item.kategorie || '').toLowerCase();
    return (
      fromTags(item.tags) ||
      (kategorie && first(KATEGORIE_REGELN, kategorie)) ||
      first(NAME_REGELN, String(item.name || '').toLowerCase()) ||
      first(MARKE_REGELN, String(item.marke || '').toLowerCase()) ||
      'sonstiges'
    );
  }

  /**
   * Gespeicherte Reihenfolge bereinigen: unbekannte raus, fehlende ergänzen, "Sonstiges" immer zuletzt.
   * Eine fehlende (z. B. neu eingeführte) Gruppe kommt hinter ihren Vorgänger aus der Standard-Reihenfolge,
   * sonst ans Ende.
   */
  function normalizeOrder(order) {
    const result = (Array.isArray(order) ? order : []).filter((id, i, a) => BY_ID.has(id) && a.indexOf(id) === i);
    DEFAULT_ORDER.forEach((id, i) => {
      if (result.includes(id)) return;
      const k = i > 0 ? result.indexOf(DEFAULT_ORDER[i - 1]) : -1;
      if (k >= 0) result.splice(k + 1, 0, id);
      else result.push(id);
    });
    return result.filter((id) => id !== 'sonstiges').concat('sonstiges');
  }

  // Stabiler Pseudozufall je (seed, EAN): gleiche Mischung nach Neuladen, neue Mischung bei neuem seed.
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /** Sortiert Artikel nach Laufweg; innerhalb jeder Warengruppe zufällig (abhängig von seed). */
  function arrange(items, order, seed) {
    const rank = new Map(normalizeOrder(order).map((id, i) => [id, i]));
    const key = (it) => hash(seed + ':' + it.code);
    return items
      .map((it) => ({ it, g: rank.get(it.gruppe || 'sonstiges'), k: key(it) }))
      .sort((a, b) => a.g - b.g || a.k - b.k)
      .map((x) => x.it);
  }

  const nameOf = (id) => (BY_ID.get(id) || BY_ID.get('sonstiges')).name;

  return { GRUPPEN, DEFAULT_ORDER, classify, fromTags, idOf, register, arrange, normalizeOrder, nameOf, hash };
});
