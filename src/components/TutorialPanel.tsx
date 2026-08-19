import { useState, type ReactNode } from 'react';
import { FloatingWindow } from './FloatingWindow';

type TutorialLang = 'en' | 'ja';

type Severity = 'must' | 'recommend' | 'optional';

type Step = {
  n: number;
  severity: Severity;
  title: ReactNode;
  body: ReactNode;
  // Warning box shown under the body (amber). Use sparingly — only for
  // things that can physically break hardware.
  warning?: string;
};

type SectionData = {
  title: string;
  steps: Step[];
  // Closing note shown under the section's steps (terminal-style box).
  footer?: ReactNode;
};

const TEXT: Record<
  TutorialLang,
  {
    severityLabel: Record<Severity, string>;
    sections: SectionData[];
  }
> = {
  en: {
    severityLabel: { must: 'MUST', recommend: 'RECOMMEND', optional: 'OPTIONAL' },
    sections: [
      {
        title: 'Common to Logging & Control',
        steps: [
          {
            n: 0,
            severity: 'must',
            title: (
              <>
                Connect sensors following the <UiRef>Connector Manual</UiRef>.
              </>
            ),
            body: (
              <>
                Unfamiliar terms like HX711, ADS1115 or GP8403: see the{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_system">
                  ModbusSimpleSystem
                </ExternalLink>{' '}
                page on GitHub, or ask AI (Gemini, ChatGPT, Claude, etc.). Board revisions differ —
                the silkscreen printed on your PCB is always the source of truth.
              </>
            ),
          },
          {
            n: 1,
            severity: 'must',
            title: 'Fill in the Labels for the channels you will use.',
            body: (
              <>
                If the physical value has a unit, put it in the label in brackets — e.g. [mm] or
                (kN). These labels appear in TSV headers and in the AI prompt, so pick names that
                will still make sense to you next month. Any special notes go in{' '}
                <UiRef>Device Memo</UiRef>.
              </>
            ),
          },
          {
            n: 2,
            severity: 'recommend',
            title: (
              <>
                Calibrate with <UiRef>Input Calib Value</UiRef> or <UiRef>Input Calibrator</UiRef>.
              </>
            ),
            body: (
              <>
                Without calibration you are logging raw ADC counts, not physical quantities.
                Already have a Raw-to-Phy conversion worked out in Excel etc.? Enter it directly in{' '}
                <UiRef>Input Calib Value</UiRef>. Calibrating from scratch? Use{' '}
                <UiRef>Input Calibrator</UiRef> — a short press grabs the instantaneous value, a
                long press the averaged one.
              </>
            ),
          },
          {
            n: 3,
            severity: 'recommend',
            title: (
              <>
                Fill in <UiRef>Device Memo</UiRef>.
              </>
            ),
            body: (
              <>
                A personal diary is the one thing not allowed. Anything else goes: useful data,
                calibration drift noticed on a given day, mechanical limits, odd movements, past
                misbehavior — write down the characteristics of your rig.
              </>
            ),
          },
        ],
      },
      {
        title: 'Control Only',
        steps: [
          {
            n: 4,
            severity: 'recommend',
            title: (
              <>
                Add more and more to <UiRef>Device Memo</UiRef>.
              </>
            ),
            body: (
              <>
                <UiRef>Device Memo</UiRef> feeds the AI Prompt, so be generous: which sensors you
                use, spec changes you made, strange noises you heard — anything about the feedback
                or the controlled object. The AI has no common sense about your specific machine;
                write down even the things that are obvious to you.
              </>
            ),
          },
          {
            n: 5,
            severity: 'recommend',
            title: (
              <>
                Check the output with <UiRef>Output Setter</UiRef>.
              </>
            ),
            body: (
              <>
                If you don't yet know how the rig responds to output, actually drive it and find
                out. Sweep the range and check for dead zones and saturation. Then record
                everything you learned — calibration values, dead bands, output limits — in{' '}
                <UiRef>Device Memo</UiRef>.
              </>
            ),
            warning:
              'Do not apply 10 V to anything that cannot take 10 V. Check the rating of the connected device before sweeping the full range.',
          },
          {
            n: 6,
            severity: 'must',
            title: (
              <>
                Read the API Reference at the bottom of the <UiRef>Script Runner</UiRef> page.
              </>
            ),
            body: (
              <>
                These are this app's own APIs for Python control (
                <code className="font-mono">GetAiPhy</code>,{' '}
                <code className="font-mono">SetAo</code>,{' '}
                <code className="font-mono">SetParam</code>, …). Misuse one and the app stops the
                moment the script runs.
              </>
            ),
          },
          {
            n: 7,
            severity: 'must',
            title: (
              <>
                Use <UiRef>Copy AI Prompt</UiRef> and try AI coding (Gemini, ChatGPT, Claude,
                etc.).
              </>
            ),
            body: (
              <>
                Flagship models are recommended: past 200–300 lines of control logic, free or cheap
                models may emit unintended programs. If you don't want to break your rig, review
                the code yourself or use a true flagship / cutting-edge model. If unsure, ask that
                AI first. Pressing <UiRef>Copy AI Prompt</UiRef> copies everything from steps 1–6
                plus a minimal prompt designed by the author (Kuno MAKOTO) — paste it into your
                favorite AI and have it write the control program.
              </>
            ),
          },
        ],
      },
      {
        title: 'For Those Who Seek Great Power',
        steps: [
          {
            n: 8,
            severity: 'optional',
            title: 'Fork this program.',
            body: (
              <>
                For complex requirements, fork this program on GitHub —{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_logger">
                  modbus_simple_logger
                </ExternalLink>{' '}
                — and build your own variant. Learn how, or ask AI. You can then add features, turn
                frequently used functions into fixed, stable APIs, and harden the whole thing.
              </>
            ),
          },
        ],
        footer: (
          <p className="text-center">
            <RedSpider /> With great power comes great responsibility. <RedSpider />
          </p>
        ),
      },
    ],
  },
  ja: {
    severityLabel: { must: '必須', recommend: '推奨', optional: '任意' },
    sections: [
      {
        title: 'ログ・制御 共通項目',
        steps: [
          {
            n: 0,
            severity: 'must',
            title: (
              <>
                <UiRef>Connector Manual</UiRef> を参照してセンサーを接続。
              </>
            ),
            body: (
              <>
                HX711・ADS1115・GP8403 など不明な単語は、GitHub の{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_system">
                  ModbusSimpleSystem
                </ExternalLink>{' '}
                ページか、AI (Gemini, ChatGPT, Claude 等) に聞くこと。基板のリビジョンで配線は異なる
                — 実物のシルク印刷が常に正しい情報源。
              </>
            ),
          },
          {
            n: 1,
            severity: 'must',
            title: '使用するチャネルのラベルを記入。',
            body: (
              <>
                物理値の単位が分かる場合は [mm]・(kN) のように括弧書きでラベルに含めること。このラベルは
                TSV ヘッダーと AI プロンプトに使われるので、来月の自分が見ても分かる名前を付けること。
                特殊な注意事項はすべて <UiRef>Device Memo</UiRef> に追記すること。
              </>
            ),
          },
          {
            n: 2,
            severity: 'recommend',
            title: (
              <>
                <UiRef>Input Calib Value</UiRef> または <UiRef>Input Calibrator</UiRef>{' '}
                でキャリブレーション。
              </>
            ),
            body: (
              <>
                キャリブレーションしないと物理量ではなく ADC の生値を記録することになる。既に Excel
                等で Raw-to-Phy の計算が済んでいるなら <UiRef>Input Calib Value</UiRef>{' '}
                に直接入力。今からキャリブレーションするなら <UiRef>Input Calibrator</UiRef> —
                単押しで瞬時値、長押しで平均値が取得できる。
              </>
            ),
          },
          {
            n: 3,
            severity: 'recommend',
            title: (
              <>
                <UiRef>Device Memo</UiRef> に記入。
              </>
            ),
            body: (
              <>
                個人的な日記をたらたら書くのだけは NG。それ以外は何でも OK —
                有効なデータ、この日にキャリブレーションのズレがあった、機械的な限界、変な動きをした、動作がおかしかった等、装置の特徴を書いておくこと。
              </>
            ),
          },
        ],
      },
      {
        title: '制御専用項目',
        steps: [
          {
            n: 4,
            severity: 'recommend',
            title: (
              <>
                <UiRef>Device Memo</UiRef> にとにかくたくさん追記。
              </>
            ),
            body: (
              <>
                <UiRef>Device Memo</UiRef> は AI Prompt
                に利用されるので、とにかくたくさん書く。どんなセンサーを使っているか、仕様をこう変更した、異音がした等、どんなことでも良い。フィードバックや制御対象に関する事項をとにかくたくさん書き込んでおくこと。AI
                はあなたの装置について常識を持っていない — あなたにとって自明なことでも書くこと。
              </>
            ),
          },
          {
            n: 5,
            severity: 'recommend',
            title: (
              <>
                <UiRef>Output Setter</UiRef> で出力を確認。
              </>
            ),
            body: (
              <>
                出力に対する挙動をまだ知らない場合は、実際に動かして確認すること。範囲を掃引して不感帯や飽和を調べる。得られたキャリブレーション値、不感帯、出力限界
                — とにかくたくさん <UiRef>Device Memo</UiRef> に記載すること。
              </>
            ),
            warning:
              '10V で壊れるものに 10V を掛けてはいけない。全範囲を掃引する前に、接続先の定格を必ず確認すること。',
          },
          {
            n: 6,
            severity: 'must',
            title: (
              <>
                <UiRef>Script Runner</UiRef> ページ下部の API Reference を読む。
              </>
            ),
            body: (
              <>
                Python で制御するにあたっての、このアプリ独自の制御 API (
                <code className="font-mono">GetAiPhy</code>,{' '}
                <code className="font-mono">SetAo</code>,{' '}
                <code className="font-mono">SetParam</code>, …)
                をざっと読むこと。使い方を間違えると、ScriptRun した瞬間にアプリが止まる。
              </>
            ),
          },
          {
            n: 7,
            severity: 'must',
            title: (
              <>
                <UiRef>Copy AI Prompt</UiRef> を使って AI でコーディングを試す (Gemini, ChatGPT,
                Claude 等)。
              </>
            ),
            body: (
              <>
                Flagship モデルを推奨する理由:
                200〜300行を超えるようなコントロールになると、無料・低価格モデルでは意図しないプログラムを
                AI
                が出力する恐れがある。装置を壊したくなければ、自分でコードを確認するか、本当に
                Flagship/最先端なモデルを使うこと。不安なら事前にその AI に相談を。
                <UiRef>Copy AI Prompt</UiRef> を押すと、ステップ 1〜6 の情報に加えて、作者 (Kuno
                MAKOTO)
                が考えた最低限の最適プロンプトがコピーされる。これをお気に入りの AI
                に入力して制御プログラムを作成してもらうこと。
              </>
            ),
          },
        ],
      },
      {
        title: '大いなる力を求める者',
        steps: [
          {
            n: 8,
            severity: 'optional',
            title: 'プログラムを Fork する。',
            body: (
              <>
                やりたいことが複雑な場合は、GitHub で公開されているこのプログラム —{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_logger">
                  modbus_simple_logger
                </ExternalLink>{' '}
                — を Fork
                して改造版を自作すること。やり方は勉強するか AI
                に聞く。さらなる機能追加、よく使う機能の API 化・固定、安定化・ロバスト化ができる。
              </>
            ),
          },
        ],
        footer: (
          <p className="text-center">
            <RedSpider /> 大いなる力には大いなる責任が伴う <RedSpider />
          </p>
        ),
      },
    ],
  },
};

export function TutorialPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [lang, setLang] = useState<TutorialLang>('en');
  const t = TEXT[lang];

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
        {t.sections.map((section) => (
          <Section
            key={section.title}
            title={section.title}
            steps={section.steps}
            footer={section.footer}
            severityLabel={t.severityLabel}
          />
        ))}
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

// 🕷 is a colour emoji, so `color` can't touch it. The filter chain
// (grayscale → darken → sepia → saturate → hue-rotate) re-tints a black
// glyph red; the exact hue varies a little per platform since each emoji
// font's base colour differs, but every target here renders a dark spider.
function RedSpider() {
  return (
    <span
      aria-hidden="true"
      className="inline-block [filter:grayscale(1)_brightness(0.55)_sepia(1)_saturate(8)_hue-rotate(-45deg)]"
    >
      🕷
    </span>
  );
}

// Inline chip for UI element names (menu items, buttons). Kept subtle — just
// a rounded background — so it reads as "this is a thing on screen" without
// shouting. translate="no": these names must match the on-screen labels
// exactly, so page translation must not touch them.
function UiRef({ children }: { children: ReactNode }) {
  return (
    <span
      translate="no"
      className="rounded bg-slate-200 px-1 py-0.5 text-[0.92em] font-semibold whitespace-nowrap text-slate-800 dark:bg-slate-700 dark:text-slate-100"
    >
      {children}
    </span>
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
  footer,
  severityLabel,
}: {
  title: string;
  steps: Step[];
  footer?: ReactNode;
  severityLabel: Record<Severity, string>;
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
            <StepRow step={step} severityLabel={severityLabel} />
          </li>
        ))}
      </ol>
      {footer && (
        <div className="mt-2 rounded bg-slate-800 p-2.5 font-mono text-xs text-slate-200 dark:bg-slate-950 dark:text-slate-300">
          {footer}
        </div>
      )}
    </section>
  );
}

function StepRow({
  step,
  severityLabel,
}: {
  step: Step;
  severityLabel: Record<Severity, string>;
}) {
  return (
    <div>
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
        <SeverityBadge severity={step.severity} label={severityLabel[step.severity]} />
      </div>
      {step.warning && (
        <p className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-xs leading-snug text-amber-800 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200">
          ⚠️ {step.warning}
        </p>
      )}
    </div>
  );
}

const SEVERITY_CLASS: Record<Severity, string> = {
  must: 'bg-red-500 text-white',
  recommend: 'bg-amber-500 text-amber-950',
  optional: 'bg-slate-400 text-white dark:bg-slate-600 dark:text-slate-100',
};

function SeverityBadge({ severity, label }: { severity: Severity; label: string }) {
  return (
    <span
      translate="no"
      className={`shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-bold uppercase leading-none tracking-wide ${SEVERITY_CLASS[severity]}`}
    >
      {label}
    </span>
  );
}
