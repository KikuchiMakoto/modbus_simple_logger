import { useState, type ReactNode } from 'react';
import { FloatingWindow } from './FloatingWindow';

type TutorialLang = 'en' | 'ja';

type Severity = 'must' | 'strong';

type Step = {
  n: number;
  // Steps with no badge (Fork, for one) are suggestions, not requirements.
  severity?: Severity;
  title: string;
  body: ReactNode;
};

const TEXT: Record<
  TutorialLang,
  {
    sectionLogControl: string;
    sectionControlOnly: string;
    mustLabel: string;
    strongLabel: string;
    steps: Step[];
  }
> = {
  en: {
    sectionLogControl: 'for Log & Control Usage',
    sectionControlOnly: 'Only for Control',
    mustLabel: 'MUST',
    strongLabel: 'STRONG RECOMMEND',
    steps: [
      {
        n: 0,
        severity: 'must',
        title: 'Connect sensors following the Connector Manual.',
        body: (
          <>
            Unfamiliar terms like HX711, ADS1115 or GP8403: see the{' '}
            <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_system">
              ModbusSimpleSystem
            </ExternalLink>{' '}
            page on GitHub, or ask AI (Gemini, ChatGPT, Claude, etc.).
          </>
        ),
      },
      {
        n: 1,
        severity: 'must',
        title: 'Fill in the Labels for the channels you will use.',
        body: 'If the physical value has a unit, put it in the label in brackets — e.g. [mm] or (kN). Any special notes go in Device Memo.',
      },
      {
        n: 2,
        severity: 'strong',
        title: 'Calibrate with Input Calib Value or Input Calibrator.',
        body: 'Already have a Raw-to-Phy conversion worked out in Excel etc.? Enter it directly in Input Calib Value. Calibrating from scratch? Use Input Calibrator — a short press grabs the instantaneous value, a long press the averaged one.',
      },
      {
        n: 3,
        severity: 'must',
        title: 'Fill in Device Memo.',
        body: 'A personal diary is the one thing not allowed. Anything else goes: useful data, calibration drift noticed on a given day, mechanical limits, odd movements, past misbehavior — write down the characteristics of your rig.',
      },
      {
        n: 4,
        severity: 'strong',
        title: 'Add more and more to Device Memo.',
        body: 'Device Memo feeds the AI Prompt, so be generous: which sensors you use, spec changes you made, strange noises you heard — anything about the feedback or the controlled object.',
      },
      {
        n: 5,
        severity: 'strong',
        title: 'Check the output with Output Setter.',
        body: "If you don't yet know how the rig responds to output, actually drive it and find out. Then record everything you learned — calibration values, dead bands, output limits — in Device Memo.",
      },
      {
        n: 6,
        severity: 'must',
        title: 'Read the API Reference at the bottom of the Script Runner page.',
        body: "These are this app's own APIs for Python control. Misuse one and the app stops the moment the script runs.",
      },
      {
        n: 7,
        severity: 'must',
        title: 'Use Copy AI Prompt and try AI coding (Gemini, ChatGPT, Claude, etc.).',
        body: "Flagship models are recommended: past 200–300 lines of control logic, free or cheap models may emit unintended programs. If you don't want to break your rig, review the code yourself or use a true flagship / cutting-edge model. If unsure, ask that AI first. Pressing Copy AI Prompt copies everything from steps 1–6 plus a minimal prompt designed by the author (Kuno MAKOTO) — paste it into your favorite AI and have it write the control program.",
      },
      {
        n: 8,
        title: 'Fork this program.',
        body: (
          <>
            For complex requirements, fork this program on GitHub —{' '}
            <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_logger">
              modbus_simple_logger
            </ExternalLink>{' '}
            — and build your own variant. Learn how, or ask AI. You can then add features, turn frequently used functions into fixed, stable APIs, and harden the whole thing.
          </>
        ),
      },
    ],
  },
  ja: {
    sectionLogControl: 'ログ・制御 共通',
    sectionControlOnly: '制御専用',
    mustLabel: '必須',
    strongLabel: '強く推奨',
    steps: [
      {
        n: 0,
        severity: 'must',
        title: 'Connector Manual を参照してセンサーを接続。',
        body: (
          <>
            HX711・ADS1115・GP8403 など不明な単語は、GitHub の{' '}
            <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_system">
              ModbusSimpleSystem
            </ExternalLink>{' '}
            ページか、AI (Gemini, ChatGPT, Claude 等) に聞くこと。
          </>
        ),
      },
      {
        n: 1,
        severity: 'must',
        title: '使用するチャネルのラベルを記入。',
        body: '物理値の単位が分かる場合は [mm]・(kN) のように括弧書きでラベルに含めること。特殊な注意事項はすべて Device Memo に追記すること。',
      },
      {
        n: 2,
        severity: 'strong',
        title: 'Input Calib Value または Input Calibrator でキャリブレーション。',
        body: '既に Excel 等で Raw-to-Phy の計算が済んでいるなら Input Calib Value に直接入力。今からキャリブレーションするなら Input Calibrator — 単押しで瞬時値、長押しで平均値が取得できる。',
      },
      {
        n: 3,
        severity: 'must',
        title: 'Device Memo に記入。',
        body: '個人的な日記をたらたら書くのだけは NG。それ以外は何でも OK — 有効なデータ、この日にキャリブレーションのズレがあった、機械的な限界、変な動きをした、動作がおかしかった等、装置の特徴を書いておくこと。',
      },
      {
        n: 4,
        severity: 'strong',
        title: 'Device Memo にとにかくたくさん追記。',
        body: 'Device Memo は AI Prompt に利用されるので、とにかくたくさん書く。どんなセンサーを使っているか、仕様をこう変更した、異音がした等、どんなことでも良い。フィードバックや制御対象に関する事項をとにかくたくさん書き込んでおくこと。',
      },
      {
        n: 5,
        severity: 'strong',
        title: 'Output Setter で出力を確認。',
        body: '出力に対する挙動をまだ知らない場合は、実際に動かして確認すること。得られたキャリブレーション値、不感帯、出力限界 — とにかくたくさん Device Memo に記載すること。',
      },
      {
        n: 6,
        severity: 'must',
        title: 'Script Runner ページ下部の API Reference を読む。',
        body: 'Python で制御するにあたっての、このアプリ独自の制御 API をざっと読むこと。使い方を間違えると、ScriptRun した瞬間にアプリが止まる。',
      },
      {
        n: 7,
        severity: 'must',
        title: 'Copy AI Prompt を使って AI でコーディングを試す (Gemini, ChatGPT, Claude 等)。',
        body: 'Flagship モデルを推奨する理由: 200〜300行を超えるようなコントロールになると、無料・低価格モデルでは意図しないプログラムを AI が出力する恐れがある。装置を壊したくなければ、自分でコードを確認するか、本当に Flagship/最先端なモデルを使うこと。不安なら事前にその AI に相談を。Copy AI Prompt を押すと、ステップ 1〜6 の情報に加えて、作者 (Kuno MAKOTO) が考えた最低限の最適プロンプトがコピーされる。これをお気に入りの AI に入力して制御プログラムを作成してもらうこと。',
      },
      {
        n: 8,
        title: 'プログラムを Fork する。',
        body: (
          <>
            やりたいことが複雑な場合は、GitHub で公開されているこのプログラム —{' '}
            <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_logger">
              modbus_simple_logger
            </ExternalLink>{' '}
            — を Fork して改造版を自作すること。やり方は勉強するか AI に聞く。さらなる機能追加、よく使う機能の API 化・固定、安定化・ロバスト化ができる。
          </>
        ),
      },
    ],
  },
};

export function TutorialPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [lang, setLang] = useState<TutorialLang>('en');
  const t = TEXT[lang];

  const logControlSteps = t.steps.slice(0, 4);
  const controlOnlySteps = t.steps.slice(4);

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Tutorial"
      defaultWidth={520}
      defaultHeight={620}
      headerActions={<LangToggle lang={lang} onChange={setLang} />}
    >
      <div
        lang={lang}
        className="flex flex-col gap-5 overflow-y-auto p-4 text-sm text-slate-700 dark:text-slate-200"
      >
        <Section
          title={t.sectionLogControl}
          steps={logControlSteps}
          mustLabel={t.mustLabel}
          strongLabel={t.strongLabel}
        />
        <Section
          title={t.sectionControlOnly}
          steps={controlOnlySteps}
          mustLabel={t.mustLabel}
          strongLabel={t.strongLabel}
        />
      </div>
    </FloatingWindow>
  );
}

// Plain function declaration (hoisted) so TEXT above can embed these in JSX.
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-emerald-600 hover:underline dark:text-emerald-400"
    >
      {children}
    </a>
  );
}

function LangToggle({ lang, onChange }: { lang: TutorialLang; onChange: (next: TutorialLang) => void }) {
  return (
    <div
      role="group"
      aria-label="Tutorial language"
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

function Section({
  title,
  steps,
  mustLabel,
  strongLabel,
}: {
  title: string;
  steps: Step[];
  mustLabel: string;
  strongLabel: string;
}) {
  return (
    <section>
      <h3 className="mb-2 font-bold text-emerald-600 dark:text-emerald-400">{title}</h3>
      <ol className="space-y-2">
        {steps.map((step) => (
          <li
            key={step.n}
            className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
          >
            <StepRow step={step} mustLabel={mustLabel} strongLabel={strongLabel} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepRow({
  step,
  mustLabel,
  strongLabel,
}: {
  step: Step;
  mustLabel: string;
  strongLabel: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        translate="no"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold leading-none text-white"
      >
        {step.n}
      </span>
      {/* min-w-0 lets the text column actually wrap instead of pushing the
          severity badge off the card's right edge. */}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{step.title}</p>
        {step.body && (
          <p className="mt-1 text-xs leading-snug text-slate-600 dark:text-slate-400">
            {step.body}
          </p>
        )}
      </div>
      <SeverityBadge severity={step.severity} mustLabel={mustLabel} strongLabel={strongLabel} />
    </div>
  );
}

function SeverityBadge({
  severity,
  mustLabel,
  strongLabel,
}: {
  severity?: Severity;
  mustLabel: string;
  strongLabel: string;
}) {
  if (severity === 'must') {
    return (
      <span
        translate="no"
        className="shrink-0 rounded bg-red-500 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase leading-none tracking-wide text-white"
      >
        {mustLabel}
      </span>
    );
  }
  if (severity === 'strong') {
    return (
      <span
        translate="no"
        className="shrink-0 rounded bg-amber-500 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase leading-none tracking-wide text-amber-950"
      >
        {strongLabel}
      </span>
    );
  }
  return null;
}
