import { type ReactNode } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { DocLanguageSelect } from './DocLanguageSelect';
import { useDocLang, type DocLang } from '../utils/docLanguage';

// Multilingual, like the Tutorial (see utils/docLanguage.ts for why only these
// two windows are). The wiring references it quotes (NDIS colour conventions,
// the Showa Sokki page) are Japanese-language material; the people running the
// cables read any of the supported languages. English is the default so the
// window matches the app on first open; the choice is shared with the Tutorial
// and remembered across launches.
type Localized = Record<DocLang, string>;

const CABLE_ROWS: {
  color: string;
  dot: string;
  abbr: string;
  name: string;
  strain: Localized;
  elec: Localized;
  ndis: string;
}[] = [
  {
    color: 'Red / R / 紅',
    dot: 'bg-red-500',
    abbr: 'E+',
    name: 'Excitation +',
    strain: { en: 'Input +', ja: '入力 +', 'zh-CN': '输入 +', 'zh-TW': '輸入 +', es: 'Entrada +', ko: '입력 +' },
    elec: { en: 'Supply', ja: '電源', 'zh-CN': '电源', 'zh-TW': '電源', es: 'Alimentación', ko: '전원' },
    ndis: 'A',
  },
  {
    color: 'Green / G / 緑',
    dot: 'bg-green-500',
    abbr: 'S+',
    name: 'Signal +',
    strain: { en: 'Output +', ja: '出力 +', 'zh-CN': '输出 +', 'zh-TW': '輸出 +', es: 'Salida +', ko: '출력 +' },
    elec: { en: 'Positive output', ja: '正出力', 'zh-CN': '正输出', 'zh-TW': '正輸出', es: 'Salida positiva', ko: '정(+) 출력' },
    ndis: 'B',
  },
  {
    color: 'Black / B / 黒',
    dot: 'bg-slate-800 dark:bg-slate-400',
    abbr: 'E−',
    name: 'Excitation −',
    strain: { en: 'Input −', ja: '入力 −', 'zh-CN': '输入 −', 'zh-TW': '輸入 −', es: 'Entrada −', ko: '입력 −' },
    elec: { en: 'Ground', ja: 'グランド', 'zh-CN': '地', 'zh-TW': '接地', es: 'Tierra', ko: '접지' },
    ndis: 'C',
  },
  {
    color: 'White / W / 白',
    dot: 'bg-slate-200 border border-slate-400',
    abbr: 'S−',
    name: 'Signal −',
    strain: { en: 'Output −', ja: '出力 −', 'zh-CN': '输出 −', 'zh-TW': '輸出 −', es: 'Salida −', ko: '출력 −' },
    elec: { en: 'Negative output', ja: '負出力', 'zh-CN': '负输出', 'zh-TW': '負輸出', es: 'Salida negativa', ko: '부(−) 출력' },
    ndis: 'D',
  },
  {
    color: 'Yellow / Y / 黄',
    dot: 'bg-yellow-400',
    abbr: 'SH',
    name: 'Shield',
    strain: { en: 'Shield', ja: 'シールド', 'zh-CN': '屏蔽', 'zh-TW': '遮蔽', es: 'Blindaje', ko: '실드' },
    elec: { en: 'Shield', ja: 'シールド', 'zh-CN': '屏蔽', 'zh-TW': '遮蔽', es: 'Blindaje', ko: '실드' },
    ndis: 'E',
  },
];

const TEXT: Record<DocLang, {
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
  'zh-CN': {
    silkFirst:
      '一切以电路板上的丝印为准。以下各图均只是多种版本中的一种——接线前请务必核对板上的实际印字。',
    cableHeading: 'HX711 电缆接线（称重传感器 / 位移计）',
    cableWarning: '⚠️ 电缆颜色因厂家而异。务必查阅数据手册。',
    colColor: '颜色',
    colAbbr: '缩写',
    colName: '功能（英文）',
    colStrain: '应变侧功能',
    colElec: '电气功能',
    ndisHeading: 'NDIS 连接器引脚排列',
    ndisNote: '7 针 NDIS 连接器，广泛用于称重传感器和位移计。',
    ndisView: '（插座，正视图）',
    ndisUnused: '本板未使用。',
    screwEntry: '入线口',
    hxLabel: 'HX711 输入 — 秋月电子模块，1×04',
    hxIntro: '每通道一个端子台，4 个端子。',
    hxBlockCaption: '入线口朝下：从左起依次为 E+、E−、S−、S+。',
    hxExcitationDesc: '电桥激励。E+ 为供电端，E− 为回线。',
    hxSignalDesc: '电桥信号，S+ 和 S−。',
    hxShieldDesc: '屏蔽线（黄），电缆带屏蔽层时使用。将其接到 E− 上。',
    hxVariantNote: '定制版使用 1×05，第 5 个端子为 SH。',
    hxVariantCaption: '入线口朝下：从左起依次为 E+、E−、S−、S+、SH。',
    hxVariantShieldDesc: '屏蔽线有专用端子。请勿再同时接到 E− 上。',
    adsLabel: 'ADS1115 输入 — 1×02，每通道一个',
    adsIntro: '共 8 个端子台，每通道一个。',
    adsBlockCaption: '入线口朝下：左为 GND，右为 SIG。',
    adsSigDesc: '信号端。丝印为十六进制通道号：8–15 印作 8–F。',
    adsGroundDesc: '地。',
    adsGroundShortSilk: '部分电路板的丝印仅为 "G"。',
    gpLabel: '模拟输出 — Gravity GP8403，1×03，2 通道',
    gpIntro: '每个端子台 2 个通道，共用中间的 GND。',
    gpBlockCaption: '入线口朝下：从左起依次为 1、GND、0——通道 0 在右侧。',
    gpOutDesc: '0–10 V 输出。丝印为 VOUT1 和 VOUT0。',
    gpGroundDesc: '地，两个通道共用。',
    gpVariantNote:
      '使用 Gravity 模块以外的 DAC 时，输出端可能与 ADS1115 侧一样采用 1×02 端子台。部分电路板将两个端子台合并为一个 1×04。',
    gpVariantCaption: '入线口朝下：左为 GND，右为通道号。',
    gpVariantOutDesc: '0–10 V 输出，每通道一个端子台。',
    gpVariantGroundDesc: '地，每个端子台一个，不共用。',
    referenceHeading: '参考资料',
    referenceLink: '昭和测器 — 连接器类型与接线方法（日文）',
  },
  'zh-TW': {
    silkFirst:
      '一律以電路板上的絲印為準。以下各圖都只是多種版本中的其中一種，接線前請先確認實物上的印字。',
    cableHeading: 'HX711 線材接線（荷重元／位移計）',
    cableWarning: '⚠️ 線材顏色因廠牌而異，請務必確認規格書。',
    colColor: '顏色',
    colAbbr: '縮寫',
    colName: '功能（英文）',
    colStrain: '功能（應變計）',
    colElec: '電氣功能',
    ndisHeading: 'NDIS 連接器腳位配置',
    ndisNote: '7 針 NDIS 連接器，廣泛用於荷重元與位移計。',
    ndisView: '（插座，正視圖）',
    ndisUnused: '本電路板未使用。',
    screwEntry: '入線口',
    hxLabel: 'HX711 輸入 — 秋月模組，1×04',
    hxIntro: '每個通道一組端子台，每組四個端子。',
    hxBlockCaption: '入線口朝下：由左至右為 E+、E−、S−、S+。',
    hxExcitationDesc: '電橋激勵。E+ 為供電端，E− 為回流端。',
    hxSignalDesc: '電橋訊號，S+ 與 S−。',
    hxShieldDesc: '遮蔽線（黃色），若線材有的話。接到 E−。',
    hxVariantNote: '客製版使用 1×05，第五個端子為 SH。',
    hxVariantCaption: '入線口朝下：由左至右為 E+、E−、S−、S+、SH。',
    hxVariantShieldDesc: '遮蔽線有專用端子。請勿同時接到 E−。',
    adsLabel: 'ADS1115 輸入 — 1×02，每通道一組',
    adsIntro: '共八組，每個通道一組。',
    adsBlockCaption: '入線口朝下：左為 GND，右為 SIG。',
    adsSigDesc: '訊號端。絲印為十六進位的通道編號：8–15 標示為 8–F。',
    adsGroundDesc: '接地。',
    adsGroundShortSilk: '部分電路板的絲印只標「G」。',
    gpLabel: '類比輸出 — Gravity GP8403，1×03，兩通道',
    gpIntro: '每組兩個通道，共用中間的 GND。',
    gpBlockCaption: '入線口朝下：1、GND、0 — 通道 0 在右側。',
    gpOutDesc: '0–10 V 輸出。絲印為 VOUT1 與 VOUT0。',
    gpGroundDesc: '接地，兩個通道共用。',
    gpVariantNote:
      '若使用 Gravity 模組以外的 DAC，輸出端可能與 ADS1115 側相同，採用 1×02 端子台。部分電路板會將兩組合併為一個 1×04。',
    gpVariantCaption: '入線口朝下：左為 GND，右為通道編號。',
    gpVariantOutDesc: '0–10 V 輸出，每個通道一組。',
    gpVariantGroundDesc: '接地，每組各一個，不共用。',
    referenceHeading: '參考資料',
    referenceLink: '昭和測器（Showa Sokki）— 連接器種類與接線方式（日文）',
  },
  'es': {
    silkFirst:
      'La serigrafía de tu placa siempre manda. Cada esquema de abajo corresponde a solo una de varias versiones de la placa: comprueba lo impreso en la tuya antes de cablear.',
    cableHeading: 'Cableado del HX711 (célula de carga / transductor de desplazamiento)',
    cableWarning: '⚠️ Los colores de los cables varían según el fabricante. Consulta siempre la hoja de datos.',
    colColor: 'Color',
    colAbbr: 'Abrev.',
    colName: 'Función (inglés)',
    colStrain: 'Función en el puente',
    colElec: 'Función eléctrica',
    ndisHeading: 'Asignación de pines del conector NDIS',
    ndisNote: 'Conector NDIS de 7 pines. Muy usado en células de carga y transductores de desplazamiento.',
    ndisView: '(conector hembra, vista frontal)',
    ndisUnused: 'No se usa en esta placa.',
    screwEntry: 'entrada de cable',
    hxLabel: 'Entrada HX711 — módulo Akizuki, 1×04',
    hxIntro: 'Un bloque por canal, cuatro bornes.',
    hxBlockCaption: 'Entrada de cable hacia abajo: E+, E−, S−, S+ desde la izquierda.',
    hxExcitationDesc: 'Excitación del puente. E+ alimentación, E− retorno.',
    hxSignalDesc: 'Señal del puente, S+ y S−.',
    hxShieldDesc: 'Blindaje (amarillo), si el cable lo tiene. Conéctalo a E−.',
    hxVariantNote: 'Una versión a medida usa un 1×05, con SH como quinto borne.',
    hxVariantCaption: 'Entrada de cable hacia abajo: E+, E−, S−, S+, SH desde la izquierda.',
    hxVariantShieldDesc: 'El blindaje tiene su propio borne. No lo conectes también a E−.',
    adsLabel: 'Entrada ADS1115 — 1×02, uno por canal',
    adsIntro: 'Ocho bloques, uno por canal.',
    adsBlockCaption: 'Entrada de cable hacia abajo: GND a la izquierda, SIG a la derecha.',
    adsSigDesc: 'Lado de señal. Serigrafiado con el número de canal en hexadecimal: 8–15 aparece como 8–F.',
    adsGroundDesc: 'Tierra.',
    adsGroundShortSilk: 'Algunas placas lo serigrafían solo como "G".',
    gpLabel: 'Salida analógica — Gravity GP8403, 1×03, dos canales',
    gpIntro: 'Dos canales por bloque, que comparten el GND central.',
    gpBlockCaption: 'Entrada de cable hacia abajo: 1, GND, 0 — el canal 0 está a la derecha.',
    gpOutDesc: 'Salida de 0–10 V. Serigrafiado VOUT1 y VOUT0.',
    gpGroundDesc: 'Tierra, compartida por ambos canales.',
    gpVariantNote:
      'Con un DAC distinto del módulo Gravity, la salida puede usar el mismo bloque 1×02 que el lado ADS1115. Algunas placas unen los dos en un único 1×04.',
    gpVariantCaption: 'Entrada de cable hacia abajo: GND a la izquierda, número de canal a la derecha.',
    gpVariantOutDesc: 'Salida de 0–10 V, un bloque por canal.',
    gpVariantGroundDesc: 'Tierra, una por bloque. No se comparte.',
    referenceHeading: 'Referencia',
    referenceLink: 'Showa Sokki — tipos de conectores y cableado (en japonés)',
  },
  'ko': {
    silkFirst:
      '항상 보드의 실크 인쇄를 우선하십시오. 아래 그림은 모두 여러 구성 중 하나의 예일 뿐입니다. 배선 전에 실제 인쇄를 확인하십시오.',
    cableHeading: 'HX711 케이블 결선 (로드셀 / 변위계)',
    cableWarning: '⚠️ 케이블 색상은 제조사마다 다릅니다. 반드시 데이터시트를 확인하십시오.',
    colColor: '색상',
    colAbbr: '약칭',
    colName: '기능(영문)',
    colStrain: '스트레인 측 역할',
    colElec: '전기적 역할',
    ndisHeading: 'NDIS 커넥터 핀 배치',
    ndisNote: '7핀 NDIS 커넥터입니다. 로드셀과 변위계에 널리 사용됩니다.',
    ndisView: '(소켓, 정면도)',
    ndisUnused: '이 보드에서는 사용하지 않습니다.',
    screwEntry: '삽입구',
    hxLabel: 'HX711 입력 — Akizuki 모듈, 1×04',
    hxIntro: '채널당 블록 1개, 단자 4개입니다.',
    hxBlockCaption: '삽입구를 아래로: 왼쪽부터 E+, E−, S−, S+.',
    hxExcitationDesc: '브리지 여기 전원입니다. E+는 공급, E−는 귀환입니다.',
    hxSignalDesc: '브리지 신호, S+ 및 S−.',
    hxShieldDesc: '케이블에 실드(노란색)가 있는 경우, E−에 함께 접속하십시오.',
    hxVariantNote: '주문 제작품은 1×05를 사용하며, 다섯 번째 단자가 SH입니다.',
    hxVariantCaption: '삽입구를 아래로: 왼쪽부터 E+, E−, S−, S+, SH.',
    hxVariantShieldDesc: '실드 전용 단자입니다. E−에 중복으로 접속하지 마십시오.',
    adsLabel: 'ADS1115 입력 — 1×02, 채널당 1개',
    adsIntro: '채널당 1개, 총 8개 블록입니다.',
    adsBlockCaption: '삽입구를 아래로: 왼쪽 GND, 오른쪽 SIG.',
    adsSigDesc: '신호 측입니다. 실크에는 채널 번호가 16진수로 인쇄되어 있어 8–15는 8–F로 표기됩니다.',
    adsGroundDesc: '접지.',
    adsGroundShortSilk: '실크가 "G"로만 표기된 보드도 있습니다.',
    gpLabel: '아날로그 출력 — Gravity GP8403, 1×03, 2채널',
    gpIntro: '블록당 2채널이며, 가운데 GND를 공유합니다.',
    gpBlockCaption: '삽입구를 아래로: 1, GND, 0 — 채널 0이 오른쪽입니다.',
    gpOutDesc: '0–10 V 출력. 실크 표기는 VOUT1 및 VOUT0입니다.',
    gpGroundDesc: '접지. 두 채널이 공유합니다.',
    gpVariantNote:
      'Gravity 모듈 이외의 DAC를 사용하는 경우, 출력 측도 ADS1115 측과 동일한 1×02 블록일 수 있습니다. 두 개를 하나의 1×04로 합친 보드도 있습니다.',
    gpVariantCaption: '삽입구를 아래로: 왼쪽 GND, 오른쪽 채널 번호.',
    gpVariantOutDesc: '0–10 V 출력. 채널당 블록 1개입니다.',
    gpVariantGroundDesc: '접지. 블록마다 1개이며 공유하지 않습니다.',
    referenceHeading: '참고 자료',
    referenceLink: 'Showa Sokki — 커넥터 종류 및 결선 방법(일본어)',
  },
};

export function ManualPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lang = useDocLang();
  const t = TEXT[lang];

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Connector Manual"
      defaultWidth={520}
      defaultHeight={620}
      headerActions={<DocLanguageSelect label="Manual language" />}
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
