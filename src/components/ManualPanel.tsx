import { useState, type ReactNode } from 'react';
import { FloatingWindow } from './FloatingWindow';

// Only this window is bilingual. The rest of the app is English, but the wiring
// references it quotes (NDIS colour conventions, the Showa Sokki page) are
// Japanese-language material, and the people running the cables read Japanese.
// English is the default so the window matches the app on first open; the
// choice then sticks for the session.
type ManualLang = 'en' | 'ja';

type Bilingual = { en: string; ja: string };

const CABLE_ROWS: {
  color: string;
  dot: string;
  abbr: string;
  name: string;
  strain: Bilingual;
  elec: Bilingual;
  ndis: string;
}[] = [
  {
    color: 'Red / R / 紅',
    dot: 'bg-red-500',
    abbr: 'E+',
    name: 'Excitation +',
    strain: { en: 'Input +', ja: '入力 +' },
    elec: { en: 'Supply', ja: '電源' },
    ndis: 'A',
  },
  {
    color: 'Green / G / 緑',
    dot: 'bg-green-500',
    abbr: 'S+',
    name: 'Signal +',
    strain: { en: 'Output +', ja: '出力 +' },
    elec: { en: 'Positive output', ja: '正出力' },
    ndis: 'B',
  },
  {
    color: 'Black / B / 黒',
    dot: 'bg-slate-800 dark:bg-slate-400',
    abbr: 'E−',
    name: 'Excitation −',
    strain: { en: 'Input −', ja: '入力 −' },
    elec: { en: 'Ground', ja: 'グランド' },
    ndis: 'C',
  },
  {
    color: 'White / W / 白',
    dot: 'bg-slate-200 border border-slate-400',
    abbr: 'S−',
    name: 'Signal −',
    strain: { en: 'Output −', ja: '出力 −' },
    elec: { en: 'Negative output', ja: '負出力' },
    ndis: 'D',
  },
  {
    color: 'Yellow / Y / 黄',
    dot: 'bg-yellow-400',
    abbr: 'SH',
    name: 'Shield',
    strain: { en: 'Shield', ja: 'シールド' },
    elec: { en: 'Shield', ja: 'シールド' },
    ndis: 'E',
  },
];

const TEXT: Record<ManualLang, {
  silkFirst: string;
  cableHeading: string;
  cableWarning: string;
  colColor: string;
  colAbbr: string;
  colName: string;
  colStrain: string;
  colElec: string;
  ndisHeading: string;
  ndisNote: string;
  ndisView: string;
  ndisUnused: string;
  screwEntry: string;
  hxLabel: string;
  hxIntro: string;
  hxBlockCaption: string;
  hxExcitationDesc: string;
  hxSignalDesc: string;
  hxShieldDesc: string;
  hxVariantNote: string;
  hxVariantCaption: string;
  hxVariantShieldDesc: string;
  adsLabel: string;
  adsIntro: string;
  adsBlockCaption: string;
  adsSigDesc: string;
  adsGroundDesc: string;
  adsGroundShortSilk: string;
  gpLabel: string;
  gpIntro: string;
  gpBlockCaption: string;
  gpOutDesc: string;
  gpGroundDesc: string;
  gpVariantNote: string;
  gpVariantCaption: string;
  gpVariantOutDesc: string;
  gpVariantGroundDesc: string;
  referenceHeading: string;
  referenceLink: string;
}> = {
  en: {
    silkFirst:
      'The silkscreen on your board always wins. Every drawing below is one build among several — check the printing before you wire.',
    cableHeading: 'HX711 cable wiring (load cell / displacement gauge)',
    cableWarning: '⚠️ Cable colours differ between makers. Always check the datasheet.',
    colColor: 'Colour',
    colAbbr: 'Abbr.',
    colName: 'Function',
    colStrain: 'Strain role',
    colElec: 'Electrical role',
    ndisHeading: 'NDIS connector pin layout',
    ndisNote: '7-pin NDIS connector. Widely used on load cells and displacement gauges.',
    ndisView: '(socket, front view)',
    ndisUnused: 'Not used on this board.',
    screwEntry: 'entry',
    hxLabel: 'HX711 input — Akizuki module, 1×04',
    hxIntro: 'One block per channel, four terminals.',
    hxBlockCaption: 'Entry down: E+, E−, S−, S+ from the left.',
    hxExcitationDesc: 'Bridge excitation. E+ supply, E− return.',
    hxSignalDesc: 'Bridge signal, S+ and S−.',
    hxShieldDesc: 'Shield (yellow), if the cable has one. Land it on E−.',
    hxVariantNote: 'A custom build uses a 1×05, with SH as the fifth terminal.',
    hxVariantCaption: 'Entry down: E+, E−, S−, S+, SH from the left.',
    hxVariantShieldDesc: 'Shield gets its own terminal. Do not land it on E− as well.',
    adsLabel: 'ADS1115 input — 1×02, one per channel',
    adsIntro: 'Eight blocks, one per channel.',
    adsBlockCaption: 'Entry down: GND left, SIG right.',
    adsSigDesc: 'Signal side. Silkscreened with the channel number in hex: 8–15 reads 8–F.',
    adsGroundDesc: 'Ground.',
    adsGroundShortSilk: 'Some boards silkscreen it as just "G".',
    gpLabel: 'Analog output — Gravity GP8403, 1×03, two channels',
    gpIntro: 'Two channels per block, sharing the middle GND.',
    gpBlockCaption: 'Entry down: 1, GND, 0 — channel 0 is on the right.',
    gpOutDesc: '0–10 V out. Silkscreened VOUT1 and VOUT0.',
    gpGroundDesc: 'Ground, shared by both channels.',
    gpVariantNote:
      'With a DAC other than the Gravity module, the output can use the same 1×02 block as the ADS1115 side. Some boards join the two into one 1×04.',
    gpVariantCaption: 'Entry down: GND left, channel number right.',
    gpVariantOutDesc: '0–10 V out, one block per channel.',
    gpVariantGroundDesc: 'Ground, one per block. Not shared.',
    referenceHeading: 'Reference',
    referenceLink: 'Showa Sokki — connector types and wiring (Japanese)',
  },
  ja: {
    silkFirst:
      '必ず基板のシルク印刷を優先してください。以下の図はいずれも構成の一例です。配線前に実物の印字を確認してください。',
    cableHeading: 'HX711 ケーブル接続（ロードセル・変位計）',
    cableWarning: '⚠️ ケーブル色はメーカーにより異なる場合があります。必ずデータシートを確認してください。',
    colColor: '色',
    colAbbr: '略称',
    colName: '機能（英語）',
    colStrain: '機能（ひずみ）',
    colElec: '電気的機能',
    ndisHeading: 'NDISコネクタ ピン配置',
    ndisNote: 'NDIS 7ピンコネクタ。ロードセル・変位計に広く使用されます。',
    ndisView: '（ソケット正面）',
    ndisUnused: 'この基板では未使用。',
    screwEntry: '入口',
    hxLabel: 'HX711 入力 — 秋月モジュール、1×04',
    hxIntro: '1chに1個、4端子。',
    hxBlockCaption: '入口を下に: 左から E+, E−, S−, S+。',
    hxExcitationDesc: 'ブリッジ電源。E+ が供給、E− が戻り。',
    hxSignalDesc: 'ブリッジ信号、S+ と S−。',
    hxShieldDesc: 'シールド（黄）がある場合。E− に一緒に接続。',
    hxVariantNote: '特注品は 1×05 で、5個目に SH が付きます。',
    hxVariantCaption: '入口を下に: 左から E+, E−, S−, S+, SH。',
    hxVariantShieldDesc: 'シールド専用の端子。E− への接続は不要です。',
    adsLabel: 'ADS1115 入力 — 1×02、1chに1個',
    adsIntro: '1chに1個、計8個。',
    adsBlockCaption: '入口を下に: 左 GND、右 SIG。',
    adsSigDesc: '信号側。シルクはチャンネル番号（16進）で、8〜15 は 8〜F。',
    adsGroundDesc: 'グランド。',
    adsGroundShortSilk: 'シルクが "G" だけの基板もあります。',
    gpLabel: 'アナログ出力 — Gravity GP8403、1×03、2ch',
    gpIntro: '1ブロックに2ch。中央の GND を共有。',
    gpBlockCaption: '入口を下に: 左から 1, GND, 0。右が ch0。',
    gpOutDesc: '0〜10V 出力。シルクは VOUT1 / VOUT0。',
    gpGroundDesc: 'グランド。2chで共有。',
    gpVariantNote:
      'Gravity 以外の DAC の場合、ADS1115 と同じ 1×02 端子のこともあります。2個を 1×04 にまとめた基板もあります。',
    gpVariantCaption: '入口を下に: 左 GND、右が番号。',
    gpVariantOutDesc: '0〜10V 出力。1chに1ブロック。',
    gpVariantGroundDesc: 'グランド。ブロックごとに1本、共有しません。',
    referenceHeading: '参考資料',
    referenceLink: '昭和測器 — コネクタ種類と接続方法',
  },
};

export function ManualPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [lang, setLang] = useState<ManualLang>('en');
  const t = TEXT[lang];

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Connector Manual"
      defaultWidth={520}
      defaultHeight={620}
      headerActions={<LangToggle lang={lang} onChange={setLang} />}
    >
      <div
        lang={lang}
        className="flex flex-col gap-5 overflow-y-auto p-4 text-sm text-slate-700 dark:text-slate-200"
      >

        {/* Every figure in this window is one build of a board that ships in
            several. The per-section warnings each cover their own variant, but
            a reader who never scrolls past the first drawing would not meet
            one, so the rule that outranks all of them is stated once, up top,
            before anything is drawn. */}
        <p className="rounded-lg border border-amber-400 bg-amber-50 p-2 text-xs leading-snug text-amber-800 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200">
          ⚠️ {t.silkFirst}
        </p>

        {/* HX711 Cable Wiring */}
        <section>
          <h3 className="mb-2 font-bold text-emerald-600 dark:text-emerald-400">
            {t.cableHeading}
          </h3>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            {t.cableWarning}
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 text-left text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <th className="px-2 py-1.5">{t.colColor}</th>
                  <th className="px-2 py-1.5">{t.colAbbr}</th>
                  <th className="px-2 py-1.5">{t.colName}</th>
                  <th className="px-2 py-1.5">{t.colStrain}</th>
                  <th className="px-2 py-1.5">{t.colElec}</th>
                  <th className="px-2 py-1.5">NDIS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {CABLE_ROWS.map((row) => (
                  <tr
                    key={row.abbr}
                    className="bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50"
                  >
                    <td className="flex items-center gap-1.5 px-2 py-1.5 font-medium whitespace-nowrap">
                      <span className={`inline-block h-3 w-3 flex-shrink-0 rounded-full ${row.dot}`} />
                      {row.color}
                    </td>
                    {/* Abbreviation, the English function name the column is
                        explicitly for, and the NDIS letter are identifiers:
                        a machine translation of "E+" or "Excitation +" is a
                        different label from the one printed on the part. */}
                    <td translate="no" className="px-2 py-1.5 font-mono font-semibold">{row.abbr}</td>
                    <td translate="no" className="px-2 py-1.5">{row.name}</td>
                    <td className="px-2 py-1.5">{row.strain[lang]}</td>
                    <td className="px-2 py-1.5">{row.elec[lang]}</td>
                    <td translate="no" className="px-2 py-1.5 font-mono font-semibold">{row.ndis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* The manual runs in the order the channels do — HX711 first, then
            ADS1115, then the output — and each part's terminal block sits with
            the part it belongs to rather than in one pooled connector section.
            NDIS follows HX711 because it is how an HX711 cable arrives, and it
            carries its own source link: a lone Reference section at the end was
            one link with nothing to attach it to. */}
        <ScrewBlockSection
          label={t.hxLabel}
          intro={t.hxIntro}
          entry={t.screwEntry}
          caption={t.hxBlockCaption}
          blocks={[['E+', 'E−', 'S−', 'S+']]}
          keys={[
            { label: 'E+ / E−', desc: t.hxExcitationDesc },
            { label: 'S− / S+', desc: t.hxSignalDesc },
            { label: 'SH', desc: t.hxShieldDesc },
          ]}
          note={t.hxVariantNote}
          variantBlocks={[['E+', 'E−', 'S−', 'S+', 'SH']]}
          variantCaption={t.hxVariantCaption}
          variantKeys={[{ label: 'SH', desc: t.hxVariantShieldDesc }]}
        />

        {/* NDIS Connector Layout */}
        <section>
          <h3 className="mb-2 font-bold text-emerald-600 dark:text-emerald-400">
            {t.ndisHeading}
          </h3>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            {t.ndisNote}
          </p>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            {/* The seven pins sit inside the shell they are actually arranged
                in: without the ring they read as a 2-3-2 grid, which is not
                how the connector is found. The ring is what makes the drawing
                match the part in hand. */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative flex h-32 w-32 flex-col items-center justify-center gap-1 rounded-full border-4 border-slate-400 bg-slate-200 dark:border-slate-500 dark:bg-slate-700">
                {/* The keyway is what fixes the plug's rotation, so the drawing
                    is oriented by it: twelve o'clock, sitting on the wall
                    itself. Its colour steps one stop past the box background,
                    away from the shell fill — white on light, slate-900 on
                    dark — so the cut separates by the same amount either way.
                    Matching the box background exactly would have worked in
                    light and all but vanished in dark, where the background
                    and the fill are a single step apart. */}
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/4 rounded-[1px] bg-white dark:bg-slate-900"
                />
                {/* Turned one seat counter-clockwise so the keyway lands at the
                    top: A takes B's old seat, B takes C's, and so on round the
                    six. Done by relabelling rather than by a CSS rotation —
                    the seats are where they were, so nothing has to be
                    counter-rotated to keep the letters upright. G is the
                    centre pin and does not move. */}
                <div className="flex flex-col items-center gap-1">
                  <div className="grid grid-cols-2 gap-1">
                    <Pin label="A" sub="E+" color="bg-red-500 text-white" />
                    <Pin label="F" sub="" color="bg-slate-500 text-white dark:bg-slate-600" unused />
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <Pin label="B" sub="S+" color="bg-green-500 text-white" />
                    <Pin label="G" sub="" color="bg-slate-500 text-white dark:bg-slate-600" unused />
                    <Pin label="E" sub="SH" color="bg-yellow-400 text-slate-800" />
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <Pin label="C" sub="E−" color="bg-black text-white border border-gray-500" />
                    <Pin label="D" sub="S−" color="bg-slate-100 text-slate-700 border border-slate-400" />
                  </div>
                </div>
              </div>
              <span className="mt-1 text-xs text-slate-400">{t.ndisView}</span>
            </div>
            <dl className="flex-1 space-y-0.5 text-xs">
              {CABLE_ROWS.map((row) => (
                <div key={row.ndis} className="flex gap-1">
                  <dt translate="no" className="w-8 shrink-0 font-mono font-bold">{row.ndis}</dt>
                  <dd className="text-slate-600 dark:text-slate-300">
                    <span translate="no">{row.abbr}</span> — {row.elec[lang]}
                  </dd>
                </div>
              ))}
              {/* F and G are on the connector but not on this board. Listed
                  rather than left out: a letter missing from the key reads as
                  an omission, and someone would go looking for what it does. */}
              <div className="flex gap-1">
                <dt translate="no" className="w-8 shrink-0 font-mono font-bold text-slate-400 dark:text-slate-500">F / G</dt>
                <dd className="text-slate-400 dark:text-slate-500">{t.ndisUnused}</dd>
              </div>
            </dl>
          </div>
          <p className="mt-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">{t.referenceHeading}: </span>
            <a
              href="https://www.showa-sokki.co.jp/technology/%E3%82%B3%E3%83%8D%E3%82%AF%E3%82%BF%E7%A8%AE%E9%A1%9E%E3%81%A8%E6%8E%A5%E7%B6%9A%E6%96%B9%E6%B3%95/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-600 hover:underline dark:text-emerald-400"
            >
              {t.referenceLink}
            </a>
          </p>
        </section>

        <ScrewBlockSection
          label={t.adsLabel}
          intro={t.adsIntro}
          entry={t.screwEntry}
          caption={t.adsBlockCaption}
          blocks={[['GND', 'SIG']]}
          keys={[
            {
              label: 'GND',
              desc: (
                <>
                  {t.adsGroundDesc} <strong>{t.adsGroundShortSilk}</strong>
                </>
              ),
            },
            { label: 'SIG', desc: t.adsSigDesc },
          ]}
        />

        <ScrewBlockSection
          label={t.gpLabel}
          intro={t.gpIntro}
          entry={t.screwEntry}
          caption={t.gpBlockCaption}
          blocks={[['1', 'GND', '0']]}
          keys={[
            { label: '1 / 0', desc: t.gpOutDesc },
            { label: 'GND', desc: t.gpGroundDesc },
          ]}
          note={t.gpVariantNote}
          variantBlocks={[
            ['GND', '0'],
            ['GND', '1'],
          ]}
          variantCaption={t.gpVariantCaption}
          variantKeys={[
            { label: '0 / 1', desc: t.gpVariantOutDesc },
            { label: 'GND', desc: t.gpVariantGroundDesc },
          ]}
        />

      </div>
    </FloatingWindow>
  );
}

function LangToggle({ lang, onChange }: { lang: ManualLang; onChange: (next: ManualLang) => void }) {
  return (
    <div
      role="group"
      aria-label="Manual language"
      translate="no"
      className="flex overflow-hidden rounded border border-slate-300 dark:border-slate-700"
    >
      {(['en', 'ja'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={lang === value}
          className={`px-2.5 py-1 text-xs font-semibold uppercase leading-none ${
            lang === value
              ? 'bg-emerald-500 text-white'
              : 'text-slate-600 hover:text-emerald-500 dark:text-slate-300 dark:hover:text-emerald-400'
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

// One part's terminal block: an emerald heading like every other section, then
// a green block drawn from its silkscreen labels with a text key beside it.
// Every block on the board is the same part in a different width, so they are
// all this one section with a different terminal list.
function ScrewBlockSection({
  label,
  intro,
  entry,
  caption,
  blocks,
  keys,
  note,
  variantBlocks,
  variantCaption,
  variantKeys,
}: {
  label: string;
  intro: string;
  entry: string;
  caption: string;
  blocks: string[][];
  keys: { label: string; desc: ReactNode }[];
  note?: string;
  variantBlocks?: string[][];
  variantCaption?: string;
  variantKeys?: { label: string; desc: ReactNode }[];
}) {
  return (
    <section className="text-xs">
      <h3 className="mb-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">{label}</h3>
      <p className="mb-2 text-slate-500 dark:text-slate-400">{intro}</p>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-4">
          <BlockFigure blocks={blocks} entry={entry} caption={caption} />
          <KeyList keys={keys} />
        </div>
      </div>
      {/* The board is built in more than one way, so the drawing above is one
          variant rather than the truth. Say so under the drawing it qualifies,
          and give the reader something countable — terminals — to tell which
          variant is in front of them. */}
      {note && (
        <p className="mt-3 border-l-2 border-amber-400 pl-2 leading-snug text-amber-700 dark:border-amber-500/60 dark:text-amber-300">
          {note}
        </p>
      )}
      {/* The variant gets the same box as the layout above it — its sentence
          inside, with its drawing — so a second board reads as another way the
          part is fitted rather than as an aside hanging off a warning. */}
      {variantBlocks && variantCaption && variantKeys && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-wrap items-center gap-4">
            <BlockFigure blocks={variantBlocks} entry={entry} caption={variantCaption} />
            <KeyList keys={variantKeys} />
          </div>
        </div>
      )}
    </section>
  );
}

// What each silkscreen label means. Every layout gets one, the variant too: a
// drawing with no key beside it reads as less documented than the one above it.
function KeyList({ keys }: { keys: { label: string; desc: ReactNode }[] }) {
  return (
    <dl className="min-w-0 flex-1 space-y-1">
      {keys.map((key) => (
        <div key={key.label} className="flex gap-2">
          <dt translate="no" className="shrink-0 whitespace-nowrap font-mono font-bold">
            {key.label}
          </dt>
          <dd className="text-slate-600 dark:text-slate-300">{key.desc}</dd>
        </div>
      ))}
    </dl>
  );
}

// The blocks of one wiring layout, side by side. A layout is not always a
// single part: the non-Gravity output boards carry one 1×02 per channel, so
// the figure has to be able to draw two blocks with a gap between them.
function BlockFigure({
  blocks,
  entry,
  caption,
}: {
  blocks: string[][];
  entry: string;
  caption: string;
}) {
  return (
    <figure className="flex shrink-0 flex-col items-center gap-1">
      <div className="flex gap-2">
        {blocks.map((block) => (
          <div
            key={block.join('-')}
            className="flex gap-0.5 rounded bg-green-700 p-0.5 shadow-inner"
          >
            {block.map((terminal) => (
              <ScrewTerminal key={terminal} label={terminal} />
            ))}
          </div>
        ))}
      </div>
      <span className="text-[0.65rem] leading-none text-slate-400">▲ {entry}</span>
      <figcaption className="max-w-[13rem] text-center text-[0.65rem] leading-tight text-slate-400">
        {caption}
      </figcaption>
    </figure>
  );
}

// One terminal of the green block, stacked the way it sits on the board: the
// slotted screw head on top, the silkscreen label under it, and the wire hole
// at the bottom edge — the orientation the block is wired in.
function ScrewTerminal({ label }: { label: string }) {
  // The block is green all through — housing and terminal faces alike. Only the
  // screw head is metal, so it is the one grey left in the drawing.
  // Sized to the widest label it has to carry — three characters, since the
  // GP8403 outputs are drawn as bare 1 / 0 rather than the full VOUT1 / VOUT0.
  // The figure sits beside its text key, so every pixel it does not take is a
  // pixel the description keeps.
  return (
    <div
      translate="no"
      className="flex h-12 w-7 flex-col items-center justify-between rounded-sm bg-green-500 py-1"
    >
      <span className="relative h-5 w-5 rounded-full border border-slate-500 bg-slate-300">
        <span className="absolute left-1/2 top-1/2 h-0.5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-600" />
      </span>
      <span className="whitespace-nowrap font-mono text-[0.7rem] font-bold leading-none tracking-tight text-green-950">
        {label}
      </span>
      <span className="h-1.5 w-4 rounded-sm bg-green-950" />
    </div>
  );
}

function Pin({
  label,
  sub,
  color,
  unused,
}: {
  label: string;
  sub: string;
  color: string;
  unused?: boolean;
}) {
  return (
    <div
      translate="no"
      className={`relative flex h-8 w-8 flex-col items-center justify-center overflow-hidden rounded-full text-center text-xs font-bold leading-none ${color} ${
        unused ? 'opacity-70' : ''
      }`}
    >
      {/* A pin with nothing on it is easy to read as a pin whose label was
          simply left off. The slash says it is meant to be empty. Clipped by
          the pin's own rounded-full overflow, so it stops at the rim. */}
      {unused && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-10 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-slate-200/90 dark:bg-slate-300/70"
        />
      )}
      <span>{label}</span>
      <span className="text-[9px] font-normal opacity-80">{sub}</span>
    </div>
  );
}
