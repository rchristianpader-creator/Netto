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

  // Standard-Laufweg: Frische am Eingang, Kühlregal, Trockensortiment, Drogerie/Haushalt, Getränke,
  // Tiefkühl vor der Kasse.
  const GRUPPEN = [
    { id: 'obst', name: 'Obst & Gemüse' },
    { id: 'brot', name: 'Brot & Backwaren' },
    { id: 'milch', name: 'Milch & Milchgetränke' },
    { id: 'joghurt', name: 'Joghurt' },
    { id: 'dessert', name: 'Quark & Desserts' },
    { id: 'butter', name: 'Butter, Sahne & Margarine' },
    { id: 'eier', name: 'Eier' },
    { id: 'kaese', name: 'Käse' },
    { id: 'wurst', name: 'Wurst & Aufschnitt' },
    { id: 'feinkost', name: 'Feinkost & Salate' },
    { id: 'fleisch', name: 'Fleisch & Geflügel' },
    { id: 'hmilch', name: 'H-Milch & Kondensmilch' },
    { id: 'konserven', name: 'Konserven & Fertiggerichte' },
    { id: 'nudeln', name: 'Nudeln, Reis & Backzutaten' },
    { id: 'saucen', name: 'Saucen, Fonds & Gewürze' },
    { id: 'fruehstueck', name: 'Frühstück & Brotaufstrich' },
    { id: 'snacks', name: 'Süßwaren & Snacks' },
    { id: 'drogerie', name: 'Drogerie & Körperpflege' },
    { id: 'haushalt', name: 'Haushalt & Papierwaren' },
    { id: 'tier', name: 'Tiernahrung' },
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
    ['eier', /\beier\b/],
    ['tk', /tiefkühl|pizza(?!käse)|schlemmerfilet|fischstäbchen|\beis\b|eiscreme|pommes/],
    ['getraenke', /\bbier\b|pils|export|saft\b|schorle|limonade|eistee|mineralwasser|\bcola\b|nektar/],
    ['milch', /espresso|macchiato|cappuccino|latte\b|milchkaffee/],
    ['hmilch', /\bh-|haltbar|kondensmilch|kaffeesahne|kaffeeweißer/],
    ['konserven', /eintopf|topf\b|konserve|\bdose\b/],
    ['dessert', /panna cotta|pudding|dessert|milchreis|grießbrei|mousse/],
    ['feinkost', /kartoffelsalat|nudelsalat|krautsalat|eiersalat|heringssalat|wurstsalat/],
    ['saucen', /sauce|soße|mayonnaise|ketchup|senf|dressing|\bfond\b|brühe|zitronello|essig/],
    ['wurst', /leberkäse|fleischkäse/],
    ['fleisch', /leberkäsbrät|\bbrät\b|\broh\b/],
    ['kaese', /käse|gouda|mozzarella|maasdamer|emmentaler|tilsiter|limburger|\bfeta\b|camembert|parmesan|edamer/],
    ['feinkost', /fleischsalat|salat\b|antipasti|hummus|\bdip\b/],
    ['konserven', /sardine|thunfisch|makrele|hering|bückling/],
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

  // 0) Kategorie-Kürzel wie bei Open Food Facts ("frozen", "meat_fish", …). Eindeutige Kürzel legen die
  //    Warengruppe fest. Grobe Kürzel: [Gruppe, Namensregeln, die innerhalb davon genauer einsortieren].
  const nameRegeln = (...ids) => NAME_REGELN.filter(([id]) => ids.includes(id));
  const KUERZEL = new Map(
    Object.entries({
      fruit_vegetables: 'obst',
      bakery: 'brot',
      cheese: 'kaese',
      canned_jarred: 'konserven',
      pasta_rice_grains: 'nudeln',
      baking: 'nudeln',
      sauces_spices_condiments: 'saucen',
      coffee_tea: 'fruehstueck',
      breakfast_cereals: 'fruehstueck',
      snacks: 'snacks',
      personal_care: 'drogerie',
      household_cleaning: 'haushalt',
      paper_hygiene: 'haushalt',
      pet: 'tier',
      beverages_nonalcoholic: 'getraenke',
      beverages_alcoholic: 'getraenke',
      frozen: 'tk',
      dairy: ['milch', nameRegeln('milch', 'joghurt', 'dessert', 'butter', 'hmilch', 'kaese')],
      meat_fish: ['fleisch', nameRegeln('wurst', 'fleisch', 'feinkost', 'konserven')],
      sweets: ['snacks', [['fruehstueck', /honig|konfitüre|marmelade|aufstrich|dicksaft/]]],
      plant_based: ['hmilch', [['fruehstueck', /aufstrich|streichcreme/]]],
    })
  );

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
    const kategorie = String(item.kategorie || '').trim().toLowerCase();
    const name = String(item.name || '').toLowerCase();
    const kuerzel = KUERZEL.get(kategorie);
    if (typeof kuerzel === 'string') return kuerzel;
    if (kuerzel) return first(kuerzel[1], name) || kuerzel[0];
    return (
      (kategorie && first(KATEGORIE_REGELN, kategorie)) ||
      first(NAME_REGELN, name) ||
      first(MARKE_REGELN, String(item.marke || '').toLowerCase()) ||
      'sonstiges'
    );
  }

  /**
   * Gespeicherte Reihenfolge bereinigen: unbekannte raus, fehlende an ihrer Standardstelle einfügen
   * (hinter der Gruppe, die im Standard-Laufweg davor kommt), "Sonstiges" immer zuletzt.
   */
  function normalizeOrder(order) {
    const result = (Array.isArray(order) ? order : []).filter(
      (id, i, a) => BY_ID.has(id) && id !== 'sonstiges' && a.indexOf(id) === i
    );
    DEFAULT_ORDER.forEach((id, i) => {
      if (id === 'sonstiges' || result.includes(id)) return;
      const davor = DEFAULT_ORDER.slice(0, i).reverse().find((g) => result.includes(g));
      result.splice(davor ? result.indexOf(davor) + 1 : 0, 0, id);
    });
    return result.concat('sonstiges');
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
