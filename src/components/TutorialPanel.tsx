import { type ReactNode } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { DocLanguageSelect } from './DocLanguageSelect';
import { useDocLang, type DocLang } from '../utils/docLanguage';
import { Alert } from '@/components/ui/alert';

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
  DocLang,
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
  'zh-CN': {
    severityLabel: { must: '必须', recommend: '推荐', optional: '可选' },
    sections: [
      {
        title: '记录与控制通用项',
        steps: [
          {
            n: 0,
            severity: 'must',
            title: (
              <>
                按照 <UiRef>Connector Manual</UiRef> 连接传感器。
              </>
            ),
            body: (
              <>
                如遇 HX711、ADS1115、GP8403 等不熟悉的术语，请查看 GitHub 上的{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_system">
                  ModbusSimpleSystem
                </ExternalLink>{' '}
                页面，或询问 AI（Gemini、ChatGPT、Claude 等）。不同版本的电路板接线各不相同 ——
                一律以实物 PCB 上的丝印为准。
              </>
            ),
          },
          {
            n: 1,
            severity: 'must',
            title: '为要使用的通道填写标签。',
            body: (
              <>
                如果物理量有单位，请用括号写进标签，例如 [mm] 或 (kN)。这些标签会出现在 TSV
                表头和 AI 提示词中，请起一个下个月的你看了仍然能明白的名字。任何特殊注意事项请写入{' '}
                <UiRef>Device Memo</UiRef>。
              </>
            ),
          },
          {
            n: 2,
            severity: 'recommend',
            title: (
              <>
                使用 <UiRef>Input Calib Value</UiRef> 或 <UiRef>Input Calibrator</UiRef> 进行标定。
              </>
            ),
            body: (
              <>
                不标定的话，记录的是 ADC 原始计数值，而不是物理量。已经在 Excel 等工具中算好了
                Raw-to-Phy 换算关系？直接填入 <UiRef>Input Calib Value</UiRef>。要从头开始标定？使用{' '}
                <UiRef>Input Calibrator</UiRef> —— 短按获取瞬时值，长按获取平均值。
              </>
            ),
          },
          {
            n: 3,
            severity: 'recommend',
            title: (
              <>
                填写 <UiRef>Device Memo</UiRef>。
              </>
            ),
            body: (
              <>
                唯一不允许的是写个人日记。其他内容都可以：有用的数据、某天发现的标定漂移、机械极限、异常动作、过去出现过的故障
                —— 把你这台装置的特性记下来。
              </>
            ),
          },
        ],
      },
      {
        title: '仅限控制',
        steps: [
          {
            n: 4,
            severity: 'recommend',
            title: (
              <>
                在 <UiRef>Device Memo</UiRef> 中尽可能多地补充内容。
              </>
            ),
            body: (
              <>
                <UiRef>Device Memo</UiRef> 会被写入 AI 提示词，所以尽管多写：用了哪些传感器、做过哪些规格变更、听到过什么异响
                —— 凡是与反馈或被控对象有关的都可以。AI 对你这台具体的装置没有任何常识；即使是你觉得理所当然的事情，也要写下来。
              </>
            ),
          },
          {
            n: 5,
            severity: 'recommend',
            title: (
              <>
                用 <UiRef>Output Setter</UiRef> 检查输出。
              </>
            ),
            body: (
              <>
                如果还不清楚装置对输出如何响应，就实际驱动它来摸清楚。在整个输出范围内扫描，检查死区和饱和。然后把所得的一切
                —— 标定值、死区、输出极限 —— 都记录到 <UiRef>Device Memo</UiRef> 中。
              </>
            ),
            warning:
              '不得对无法承受 10 V 的设备施加 10 V。扫描全范围之前，务必确认所连接设备的额定值。',
          },
          {
            n: 6,
            severity: 'must',
            title: (
              <>
                阅读 <UiRef>Script Runner</UiRef> 页面底部的 API Reference。
              </>
            ),
            body: (
              <>
                这些是本软件用于 Python 控制的专有 API（
                <code className="font-mono">GetAiPhy</code>,{' '}
                <code className="font-mono">SetAo</code>,{' '}
                <code className="font-mono">SetParam</code>, …）。用错一个，脚本一运行软件就会停止。
              </>
            ),
          },
          {
            n: 7,
            severity: 'must',
            title: (
              <>
                使用 <UiRef>Copy AI Prompt</UiRef> 尝试 AI 编程（Gemini、ChatGPT、Claude 等）。
              </>
            ),
            body: (
              <>
                推荐使用旗舰模型：控制逻辑一旦超过 200–300 行，免费或低价模型可能会输出不符合预期的程序。如果不想弄坏装置，请自己审查代码，或使用真正的旗舰/最前沿模型。拿不准的话，先问问那个
                AI。按下 <UiRef>Copy AI Prompt</UiRef> 会复制第 1–6 步的全部信息，外加作者（Kuno
                MAKOTO）设计的最小提示词 —— 把它粘贴到你常用的 AI 中，让它编写控制程序。
              </>
            ),
          },
        ],
      },
      {
        title: '致追求强大力量的人',
        steps: [
          {
            n: 8,
            severity: 'optional',
            title: 'Fork 本程序。',
            body: (
              <>
                如果需求复杂，请在 GitHub 上 Fork 本程序 ——{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_logger">
                  modbus_simple_logger
                </ExternalLink>{' '}
                —— 构建你自己的版本。方法可以自己学，也可以问 AI。之后你可以添加功能、把常用功能固化为稳定的 API，并全面提升其健壮性。
              </>
            ),
          },
        ],
        footer: (
          <p className="text-center">
            <RedSpider /> 能力越大，责任越大 <RedSpider />
          </p>
        ),
      },
    ],
  },
  'zh-TW': {
    severityLabel: { must: '必要', recommend: '建議', optional: '選用' },
    sections: [
      {
        title: '記錄與控制共通項目',
        steps: [
          {
            n: 0,
            severity: 'must',
            title: (
              <>
                依照 <UiRef>Connector Manual</UiRef> 連接感測器。
              </>
            ),
            body: (
              <>
                遇到 HX711、ADS1115、GP8403 等不熟悉的名詞，請參閱 GitHub 上的{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_system">
                  ModbusSimpleSystem
                </ExternalLink>{' '}
                頁面，或詢問 AI（Gemini、ChatGPT、Claude 等）。不同版次的電路板接線不同——一律以實際電路板上的絲印為準。
              </>
            ),
          },
          {
            n: 1,
            severity: 'must',
            title: '為要使用的通道填寫標籤。',
            body: (
              <>
                若物理量有單位，請以括號寫入標籤，例如 [mm] 或 (kN)。這些標籤會出現在 TSV 標頭與 AI
                提示詞中，請取一個下個月的自己看了也懂的名稱。任何特殊注意事項都寫進{' '}
                <UiRef>Device Memo</UiRef>。
              </>
            ),
          },
          {
            n: 2,
            severity: 'recommend',
            title: (
              <>
                使用 <UiRef>Input Calib Value</UiRef> 或 <UiRef>Input Calibrator</UiRef> 進行校正。
              </>
            ),
            body: (
              <>
                未經校正，記錄到的是 ADC 原始計數值，而不是物理量。若已在 Excel 等工具中算好
                Raw-to-Phy 換算式，請直接輸入到 <UiRef>Input Calib Value</UiRef>。若要從頭校正，請使用{' '}
                <UiRef>Input Calibrator</UiRef>——短按擷取瞬時值，長按擷取平均值。
              </>
            ),
          },
          {
            n: 3,
            severity: 'recommend',
            title: (
              <>
                填寫 <UiRef>Device Memo</UiRef>。
              </>
            ),
            body: (
              <>
                唯一不行的是寫成個人日記。除此之外什麼都可以：有用的數據、某天發現的校正偏移、機械極限、異常的動作、過去出過的毛病——把你這套設備的特性都記下來。
              </>
            ),
          },
        ],
      },
      {
        title: '控制專用項目',
        steps: [
          {
            n: 4,
            severity: 'recommend',
            title: (
              <>
                在 <UiRef>Device Memo</UiRef> 中持續補充，越多越好。
              </>
            ),
            body: (
              <>
                <UiRef>Device Memo</UiRef> 會被用於 AI Prompt，所以請盡量多寫：用了哪些感測器、做過哪些規格變更、聽到什麼異音——任何與回授或控制對象有關的事都可以。AI
                對你這台機器沒有任何常識；即使是你覺得理所當然的事也要寫下來。
              </>
            ),
          },
          {
            n: 5,
            severity: 'recommend',
            title: (
              <>
                用 <UiRef>Output Setter</UiRef> 確認輸出。
              </>
            ),
            body: (
              <>
                如果還不清楚設備對輸出的反應，請實際驅動看看。掃描整個範圍，檢查是否有死區與飽和。接著把所得到的一切——校正值、死區、輸出極限——全部記錄到{' '}
                <UiRef>Device Memo</UiRef>。
              </>
            ),
            warning:
              '切勿對承受不了 10 V 的裝置施加 10 V。掃描全範圍之前，務必確認所連接裝置的額定值。',
          },
          {
            n: 6,
            severity: 'must',
            title: (
              <>
                閱讀 <UiRef>Script Runner</UiRef> 頁面底部的 API Reference。
              </>
            ),
            body: (
              <>
                這些是本應用程式專為 Python 控制提供的 API（
                <code className="font-mono">GetAiPhy</code>、
                <code className="font-mono">SetAo</code>、
                <code className="font-mono">SetParam</code>…）。只要用錯一個，腳本一執行，應用程式就會停止。
              </>
            ),
          },
          {
            n: 7,
            severity: 'must',
            title: (
              <>
                使用 <UiRef>Copy AI Prompt</UiRef>，嘗試以 AI 撰寫程式（Gemini、ChatGPT、Claude 等）。
              </>
            ),
            body: (
              <>
                建議使用旗艦模型：控制邏輯一旦超過 200～300 行，免費或低價模型可能產生非預期的程式。若不想弄壞設備，請自行審查程式碼，或使用真正的旗艦／最先進模型。若沒有把握，先問問該 AI。按下{' '}
                <UiRef>Copy AI Prompt</UiRef> 會複製步驟 1～6 的所有資訊，以及作者（Kuno
                MAKOTO）設計的最精簡提示詞——貼到你慣用的 AI，請它撰寫控制程式。
              </>
            ),
          },
        ],
      },
      {
        title: '給追求強大力量的人',
        steps: [
          {
            n: 8,
            severity: 'optional',
            title: 'Fork 這個程式。',
            body: (
              <>
                需求複雜時，請在 GitHub 上 Fork 這個程式——
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_logger">
                  modbus_simple_logger
                </ExternalLink>
                ——打造你自己的版本。做法可以自己學，或問 AI。之後就能新增功能、把常用功能固定成穩定的 API，並讓整體更加穩健。
              </>
            ),
          },
        ],
        footer: (
          <p className="text-center">
            <RedSpider /> 能力越強，責任越大 <RedSpider />
          </p>
        ),
      },
    ],
  },
  'es': {
    severityLabel: { must: 'OBLIGATORIO', recommend: 'RECOMENDADO', optional: 'OPCIONAL' },
    sections: [
      {
        title: 'Común a registro y control',
        steps: [
          {
            n: 0,
            severity: 'must',
            title: (
              <>
                Conecta los sensores siguiendo el <UiRef>Connector Manual</UiRef>.
              </>
            ),
            body: (
              <>
                Si no conoces términos como HX711, ADS1115 o GP8403, consulta la página{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_system">
                  ModbusSimpleSystem
                </ExternalLink>{' '}
                en GitHub o pregunta a una IA (Gemini, ChatGPT, Claude, etc.). Las revisiones de la
                placa difieren: la serigrafía impresa en tu PCB es siempre la referencia definitiva.
              </>
            ),
          },
          {
            n: 1,
            severity: 'must',
            title: 'Rellena las etiquetas de los canales que vayas a usar.',
            body: (
              <>
                Si el valor físico tiene unidad, inclúyela en la etiqueta entre corchetes o
                paréntesis, p. ej. [mm] o (kN). Estas etiquetas aparecen en los encabezados del TSV
                y en el prompt para la IA, así que elige nombres que sigan teniendo sentido para ti
                el mes que viene. Cualquier observación especial va en <UiRef>Device Memo</UiRef>.
              </>
            ),
          },
          {
            n: 2,
            severity: 'recommend',
            title: (
              <>
                Calibra con <UiRef>Input Calib Value</UiRef> o <UiRef>Input Calibrator</UiRef>.
              </>
            ),
            body: (
              <>
                Sin calibración estarás registrando valores brutos (cuentas) del ADC, no magnitudes
                físicas. ¿Ya tienes calculada la conversión Raw-to-Phy en Excel u otra herramienta?
                Introdúcela directamente en <UiRef>Input Calib Value</UiRef>. ¿Vas a calibrar desde
                cero? Usa <UiRef>Input Calibrator</UiRef>: una pulsación corta captura el valor
                instantáneo y una pulsación larga, el valor promediado.
              </>
            ),
          },
          {
            n: 3,
            severity: 'recommend',
            title: (
              <>
                Rellena <UiRef>Device Memo</UiRef>.
              </>
            ),
            body: (
              <>
                Lo único que no está permitido es un diario personal. Todo lo demás vale: datos
                útiles, una deriva de calibración detectada un día concreto, límites mecánicos,
                movimientos extraños, comportamientos anómalos pasados… Anota las características
                de tu equipo.
              </>
            ),
          },
        ],
      },
      {
        title: 'Solo para control',
        steps: [
          {
            n: 4,
            severity: 'recommend',
            title: (
              <>
                Amplía <UiRef>Device Memo</UiRef> todo lo que puedas.
              </>
            ),
            body: (
              <>
                <UiRef>Device Memo</UiRef> alimenta el AI Prompt, así que no te quedes corto: qué
                sensores usas, qué cambios de especificación hiciste, ruidos extraños que oíste…
                cualquier cosa sobre la realimentación o el objeto controlado. La IA no tiene ningún
                sentido común sobre tu máquina concreta; anota incluso lo que para ti es obvio.
              </>
            ),
          },
          {
            n: 5,
            severity: 'recommend',
            title: (
              <>
                Comprueba la salida con <UiRef>Output Setter</UiRef>.
              </>
            ),
            body: (
              <>
                Si todavía no sabes cómo responde el equipo a la salida, hazlo funcionar de verdad
                y compruébalo. Recorre todo el rango y busca zonas muertas y saturación. Después
                registra todo lo que hayas aprendido —valores de calibración, bandas muertas,
                límites de salida— en <UiRef>Device Memo</UiRef>.
              </>
            ),
            warning:
              'No apliques 10 V a nada que no soporte 10 V. Comprueba los valores nominales del dispositivo conectado antes de recorrer el rango completo.',
          },
          {
            n: 6,
            severity: 'must',
            title: (
              <>
                Lee la API Reference al final de la página de <UiRef>Script Runner</UiRef>.
              </>
            ),
            body: (
              <>
                Son las APIs propias de esta aplicación para el control con Python (
                <code className="font-mono">GetAiPhy</code>,{' '}
                <code className="font-mono">SetAo</code>,{' '}
                <code className="font-mono">SetParam</code>, …). Si usas mal alguna, la aplicación
                se detiene en el momento en que se ejecuta el script.
              </>
            ),
          },
          {
            n: 7,
            severity: 'must',
            title: (
              <>
                Usa <UiRef>Copy AI Prompt</UiRef> y prueba a programar con IA (Gemini, ChatGPT,
                Claude, etc.).
              </>
            ),
            body: (
              <>
                Se recomiendan los modelos insignia: a partir de 200–300 líneas de lógica de
                control, los modelos gratuitos o baratos pueden generar programas que no hacen lo
                que pretendías. Si no quieres romper tu equipo, revisa el código tú mismo o usa un
                modelo verdaderamente insignia o de última generación. Si tienes dudas, consúltalo
                antes con esa IA. Al pulsar <UiRef>Copy AI Prompt</UiRef> se copia todo lo de los
                pasos 1–6 más un prompt mínimo diseñado por el autor (Kuno MAKOTO): pégalo en tu IA
                favorita y haz que escriba el programa de control.
              </>
            ),
          },
        ],
      },
      {
        title: 'Para quienes buscan un gran poder',
        steps: [
          {
            n: 8,
            severity: 'optional',
            title: 'Haz un fork de este programa.',
            body: (
              <>
                Si tus requisitos son complejos, haz un fork de este programa en GitHub —{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_logger">
                  modbus_simple_logger
                </ExternalLink>{' '}
                — y crea tu propia variante. Aprende a hacerlo o pregunta a una IA. Así podrás
                añadir funciones, convertir las funciones que más usas en APIs fijas y estables, y
                hacer el conjunto más robusto.
              </>
            ),
          },
        ],
        footer: (
          <p className="text-center">
            <RedSpider /> Un gran poder conlleva una gran responsabilidad. <RedSpider />
          </p>
        ),
      },
    ],
  },
  'ko': {
    severityLabel: { must: '필수', recommend: '권장', optional: '선택' },
    sections: [
      {
        title: '로깅·제어 공통 항목',
        steps: [
          {
            n: 0,
            severity: 'must',
            title: (
              <>
                <UiRef>Connector Manual</UiRef>을 참고하여 센서를 연결합니다.
              </>
            ),
            body: (
              <>
                HX711, ADS1115, GP8403 등 생소한 용어는 GitHub의{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_system">
                  ModbusSimpleSystem
                </ExternalLink>{' '}
                페이지를 참고하거나 AI(Gemini, ChatGPT, Claude 등)에게 물어보십시오. 보드 리비전마다
                배선이 다릅니다 — 실제 PCB에 인쇄된 실크스크린이 언제나 최종 기준입니다.
              </>
            ),
          },
          {
            n: 1,
            severity: 'must',
            title: '사용할 채널의 라벨을 입력합니다.',
            body: (
              <>
                물리량에 단위가 있으면 [mm] 또는 (kN)처럼 괄호로 라벨에 포함하십시오. 이 라벨은 TSV
                헤더와 AI 프롬프트에 사용되므로, 다음 달에 다시 보아도 알 수 있는 이름을 붙이십시오.
                특별한 주의 사항은 모두 <UiRef>Device Memo</UiRef>에 기록하십시오.
              </>
            ),
          },
          {
            n: 2,
            severity: 'recommend',
            title: (
              <>
                <UiRef>Input Calib Value</UiRef> 또는 <UiRef>Input Calibrator</UiRef>로 교정합니다.
              </>
            ),
            body: (
              <>
                교정하지 않으면 물리량이 아닌 ADC 원시 카운트를 기록하게 됩니다. Excel 등으로 이미
                Raw-to-Phy 변환식을 구해 두었다면 <UiRef>Input Calib Value</UiRef>에 직접 입력하십시오.
                처음부터 교정한다면 <UiRef>Input Calibrator</UiRef>를 사용하십시오 — 짧게 누르면
                순시값, 길게 누르면 평균값을 취득합니다.
              </>
            ),
          },
          {
            n: 3,
            severity: 'recommend',
            title: (
              <>
                <UiRef>Device Memo</UiRef>를 작성합니다.
              </>
            ),
            body: (
              <>
                개인적인 일기만은 쓰지 마십시오. 그 외에는 무엇이든 좋습니다 — 유용한 데이터, 특정
                날짜에 발견한 교정 드리프트, 기계적 한계, 이상한 움직임, 과거의 오동작 등 장치의 특성을
                기록해 두십시오.
              </>
            ),
          },
        ],
      },
      {
        title: '제어 전용 항목',
        steps: [
          {
            n: 4,
            severity: 'recommend',
            title: (
              <>
                <UiRef>Device Memo</UiRef>에 최대한 많이 추가합니다.
              </>
            ),
            body: (
              <>
                <UiRef>Device Memo</UiRef>는 AI Prompt에 사용되므로 아낌없이 작성하십시오. 어떤
                센서를 사용하는지, 어떤 사양 변경을 했는지, 이상한 소음이 났는지 등 피드백이나 제어
                대상에 관한 것이라면 무엇이든 좋습니다. AI는 여러분의 장치에 대한 상식이 없습니다.
                여러분에게 자명한 내용이라도 기록하십시오.
              </>
            ),
          },
          {
            n: 5,
            severity: 'recommend',
            title: (
              <>
                <UiRef>Output Setter</UiRef>로 출력을 확인합니다.
              </>
            ),
            body: (
              <>
                출력에 대해 장치가 어떻게 반응하는지 아직 모른다면 실제로 구동하여 확인하십시오. 범위를
                스윕하여 불감대와 포화를 점검하십시오. 그런 다음 알게 된 모든 것 — 교정값, 불감대, 출력
                한계 — 을 <UiRef>Device Memo</UiRef>에 기록하십시오.
              </>
            ),
            warning:
              '10 V를 견디지 못하는 기기에 10 V를 인가하지 마십시오. 전체 범위를 스윕하기 전에 반드시 연결된 기기의 정격을 확인하십시오.',
          },
          {
            n: 6,
            severity: 'must',
            title: (
              <>
                <UiRef>Script Runner</UiRef> 페이지 하단의 API Reference를 읽습니다.
              </>
            ),
            body: (
              <>
                Python으로 제어하기 위한 이 앱 고유의 API(
                <code className="font-mono">GetAiPhy</code>,{' '}
                <code className="font-mono">SetAo</code>,{' '}
                <code className="font-mono">SetParam</code>, …)입니다. 하나라도 잘못 사용하면
                스크립트를 실행하는 순간 앱이 멈춥니다.
              </>
            ),
          },
          {
            n: 7,
            severity: 'must',
            title: (
              <>
                <UiRef>Copy AI Prompt</UiRef>를 사용하여 AI 코딩(Gemini, ChatGPT, Claude 등)을
                시도합니다.
              </>
            ),
            body: (
              <>
                플래그십 모델을 권장합니다. 제어 로직이 200~300줄을 넘으면 무료 또는 저가 모델은
                의도하지 않은 프로그램을 출력할 수 있습니다. 장치를 망가뜨리고 싶지 않다면 코드를 직접
                검토하거나 진정한 플래그십/최첨단 모델을 사용하십시오. 확신이 서지 않으면 먼저 그 AI에게
                물어보십시오.{' '}
                <UiRef>Copy AI Prompt</UiRef>를 누르면 1~6단계의 모든 정보와 함께 작성자(Kuno
                MAKOTO)가 설계한 최소한의 프롬프트가 복사됩니다. 이를 원하는 AI에 붙여 넣어 제어
                프로그램을 작성하게 하십시오.
              </>
            ),
          },
        ],
      },
      {
        title: '큰 힘을 원하는 분께',
        steps: [
          {
            n: 8,
            severity: 'optional',
            title: '이 프로그램을 Fork합니다.',
            body: (
              <>
                요구 사항이 복잡하다면 GitHub에 공개된 이 프로그램 —{' '}
                <ExternalLink href="https://github.com/KikuchiMakoto/modbus_simple_logger">
                  modbus_simple_logger
                </ExternalLink>{' '}
                — 을 Fork하여 자신만의 개조판을 만드십시오. 방법은 직접 공부하거나 AI에게
                물어보십시오. 그러면 기능을 추가하고, 자주 쓰는 기능을 고정된 안정 API로 만들고, 전체를
                견고하게 다듬을 수 있습니다.
              </>
            ),
          },
        ],
        footer: (
          <p className="text-center">
            <RedSpider /> 큰 힘에는 큰 책임이 따른다. <RedSpider />
          </p>
        ),
      },
    ],
  },
};

export function TutorialPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lang = useDocLang();
  const t = TEXT[lang];

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Tutorial"
      defaultWidth={520}
      defaultHeight={620}
      headerActions={<DocLanguageSelect label="Tutorial language" />}
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
        <Alert variant="warning" className="mt-2 p-2 text-xs font-normal text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          ⚠️ {step.warning}
        </Alert>
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
