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
    { id: 'snacks', name: 'Snacks & Nüsse' },
    { id: 'getraenke', name: 'Getränke' },
    { id: 'tk', name: 'Tiefkühl' },
    { id: 'sonstiges', name: 'Sonstiges' },
  ];
  const BY_ID = new Map(GRUPPEN.map((g) => [g.id, g]));
  const DEFAULT_ORDER = GRUPPEN.map((g) => g.id);

  // 1) Kategorie aus der CSV (wo vorhanden) – erste passende Regel gewinnt.
  const KATEGORIE_REGELN = [
    ['getraenke', /getränk|bier|wein|saft|schorle|limonade|wasser/],
    ['tk', /tiefkühl|\btk\b/],
    ['konserven', /konserve|fertiggericht|eintopf/],
    ['saucen', /sauce|soße|ketchup|würz|fond|suppe|feinkost/],
    ['nudeln', /nudel|pasta|reis\b|backzutat|zucker|mehl|trockensortiment/],
    ['fruehstueck', /aufstrich|frühstück|müsli|kaffee|\btee\b/],
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
    ['hmilch', /\bh-|haltbar|kondensmilch|kaffeesahne/],
    ['konserven', /eintopf|topf\b|konserve|\bdose\b/],
    ['dessert', /panna cotta|pudding|dessert|milchreis|grießbrei|mousse/],
    ['saucen', /sauce|soße|mayonnaise|ketchup|senf|dressing|\bfond\b|brühe|zitronello|essig/],
    ['wurst', /leberkäse|fleischkäse/],
    ['fleisch', /leberkäsbrät|\bbrät\b|\broh\b/],
    ['kaese', /käse|gouda|mozzarella|maasdamer|emmentaler|tilsiter|limburger|\bfeta\b|camembert|parmesan|edamer/],
    ['feinkost', /fleischsalat|salat\b|antipasti|hummus|\bdip\b/],
    ['fleisch', /hackfleisch|gulasch|steak|hähnchen|puten|geschnetzeltes|schenkel|beinscheiben|innenfilet|kotelett|schnitzel|burger|braten\b/],
    ['wurst', /wurst|würstchen|schinken|lyoner|salami|mortadella|kasseler|aufschnitt|pastete|pfefferbeisser|prosciutto|speck\b|cabanossi/],
    ['dessert', /quark|protein|genussmoment/],
    ['joghurt', /joghurt|skyr/],
    ['milch', /milch|kefir|lassi|drink|kakao/],
    ['butter', /butter|margarine|sahne|schmand|crème|creme/],
    ['nudeln', /nudel|spaghetti|lasagne|tortiglioni|fusilli|farfalle|linguine|maccheroni|penne|\breis\b|mehl|zucker|backkakao/],
    ['fruehstueck', /aufstrich|marmelade|konfitüre|honig|müsli|cornflakes|kaffee|\btee\b|nougat/],
    ['snacks', /chips|knabber|nüsse|erdnuss|mandeln|cashew|studentenfutter|riegel|gebäck|salzstangen|flips|keks|schokolade/],
    ['konserven', /mais\b|bohnen|erbsen|champignon|ananas|püree|fruchtmus|tomaten/],
  ];

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

  /** Warengruppe (id) eines Artikels; eine Spalte "warengruppe" in der CSV hat Vorrang. */
  function classify(item) {
    const explicit = String(item.warengruppe || '').trim().toLowerCase();
    if (explicit) {
      const g = GRUPPEN.find((x) => x.id === explicit || x.name.toLowerCase() === explicit);
      if (g) return g.id;
    }
    const kategorie = String(item.kategorie || '').toLowerCase();
    return (
      (kategorie && first(KATEGORIE_REGELN, kategorie)) ||
      first(NAME_REGELN, String(item.name || '').toLowerCase()) ||
      first(MARKE_REGELN, String(item.marke || '').toLowerCase()) ||
      'sonstiges'
    );
  }

  /** Gespeicherte Reihenfolge bereinigen: unbekannte raus, fehlende ergänzen, "Sonstiges" immer zuletzt. */
  function normalizeOrder(order) {
    const known = (Array.isArray(order) ? order : []).filter((id, i, a) => BY_ID.has(id) && a.indexOf(id) === i);
    const missing = DEFAULT_ORDER.filter((id) => !known.includes(id));
    return known.concat(missing).filter((id) => id !== 'sonstiges').concat('sonstiges');
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

  return { GRUPPEN, DEFAULT_ORDER, classify, arrange, normalizeOrder, nameOf, hash };
});
