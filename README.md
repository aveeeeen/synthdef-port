# Digitone FM Synth Clone for Strudel (`syn`)

Elektron Digitone の 4 オペレーター FM シンセシス・アーキテクチャを Web Audio API および [Strudel](https://strudel.cc) 環境向けに再現したシンセボイス実装 [`syn`](file:///Users/braveeeeen/dev/synthdef-port/strudel-out/strudel-digitone-clone.js#L2201) の利用ガイドです。

8つの FM アルゴリズム、ハーモニクス波形モーフィング、オペレーター/ピッチ/アンプの各エンベロープ、Base-Width フィルター、マルチモードフィルター、オーバードライブなど、Digitone 特有のサウンドメイクを Strudel 上で直感的にコーディングできます。

実装コード: [strudel-out/strudel-digitone-clone.js](file:///Users/braveeeeen/dev/synthdef-port/strudel-out/strudel-digitone-clone.js)

---

## 目次

1. [初期設定手順（Strudel への読み込み）](#初期設定手順strudel-への読み込み)
2. [クイックスタート](#クイックスタート)
3. [FM アーキテクチャとオペレーター構成](#fm-アーキテクチャとオペレーター構成)
4. [アルゴリズム一覧（Algo 1〜8）](#アルゴリズム一覧algo-18)
5. [パラメータリファレンス](#パラメータリファレンス)
   - [基本・音程パラメータ](#基本音程パラメータ)
   - [FM シンセシス・オペレーターパラメータ](#fm-シンセシスオペレーターパラメータ)
   - [エンベロープ（オペレーター / ピッチ / アンプ）](#エンベロープオペレーター--ピッチ--アンプ)
   - [フィルター（Base-Width / Multimode）](#フィルターbase-width--multimode)
   - [オーバードライブ・パン・ボリューム](#オーバードライブパンボリューム)
6. [サウンドデザイン・実践レシピ](#サウンドデザイン実践レシピ)

---

## 初期設定手順（Strudel への読み込み）

Strudel の Web エディタ（[strudel.cc](https://strudel.cc)）で `syn` シンセを使うための初期設定です。

1. **コードのコピー**:
   - [strudel-out/strudel-digitone-clone.js](file:///Users/braveeeeen/dev/synthdef-port/strudel-out/strudel-digitone-clone.js) の内容をすべてクリップボードにコピーします。
2. **Prebake セクションを開く**:
   - Strudel エディタのメニューまたは設定パネルから **Prebake** セクション（初期化スクリプト領域）を開きます。
3. **ペースト＆評価**:
   - Prebake セクションにコードをペーストします。
   - `Ctrl + Enter`（macOS の場合は `Cmd + Enter`）を押してコードを評価・読み込みます。
4. **準備完了**:
   - これでサウンド名 `'syn'` と各専用パラメータ（`algo`, `harm`, `fdbk`, `drv`, `ratioA`, `ratioB`, `ratioC`, `levA`, `levB`, `base`, `width`, `fltr_freq` など）が Strudel に登録され、通常のエディタ部で即座に使用できるようになります。

---

## クイックスタート

エディタ部で以下のように `.s("syn")` を指定して鳴らします。

```javascript
// シンプルな FM メロディ
note("c3 eb3 g3 bb3")
  .s("syn")
  .algo(1)
  .ratioA(2)
  .ratioB(1)
  .levA(80)
  .fdbk(40)
  .play()
```

Digitone の特徴であるソフトクリップ・オーバードライブやデュアルフィルターも直接チェーン可能です。

```javascript
// ドライブの効いた太い FM ベース
note("c2 [~ c2] [eb2 f2] g2")
  .s("syn")
  .algo(1)
  .ratioA(1)
  .ratioC(1)
  .levA(90)
  .decA(0.2)
  .drv(45)
  .base(15)
  .width(75)
  .decay(0.3)
  .sustain(0)
  .play()
```

---

## FM アーキテクチャとオペレーター構成

Digitone は 4 つのオペレーター（**C**, **A**, **B1**, **B2**）で構成されています。

- **Operator C**: メインキャリア。常に音声信号を出力（X 側）します。
- **Operator A**: 主に Operator C を周波数変調（FM）するモジュレーター。フィードバックを持つアルゴリズムが多いです。
- **Operator B1 & B2**: サブキャリアまたは第2モジュレーター。
  - レシオは `ratioB` で一括指定するか、`ratioB1`, `ratioB2` で個別に指定可能。
  - `levB` パラメータ（0〜127）によって B1 と B2 の出力バランスが滑らかにクロスフェードします。
- **Harmonics (`harm`)**:
  - 正の値（+1 〜 +26）: モジュレーター（A, B1）の波形を鋸波、矩形波、ベル風倍音へと連続モーフィング。
  - 負の値（-1 〜 -26）: キャリア（C）の波形をモーフィング。
- **Mix (`mix`)**:
  - キャリア C 出力（X 側）と キャリア B1 出力（Y 側）のパン・ミックスバランス（-64〜+63）。

---

## アルゴリズム一覧（Algo 1〜8）

`algo(1)` 〜 `algo(8)` でオペレーター間の接続構造を切り替えます。各アルゴリズムの実装は [getDigitoneAlgorithm](file:///Users/braveeeeen/dev/synthdef-port/strudel-out/strudel-digitone-clone.js#L1435) に定義されています。

| Algo | モジュレーション経路 | 出力 (X / Y) | フィードバック | 特徴・推奨用途 |
| :--- | :--- | :--- | :--- | :--- |
| **1** | `C <- A`, `B1 <- B2` | `C` (X), `B1` (Y) | `A` | 最も標準的な 2系統独立 FM。太いベースやリードに最適。 |
| **2** | `C <- A`, `B1 <- B2` | `C` (X), `B1` (Y) | `B2` | B側にフィードバックがある独立 2系統 FM。複雑な倍音変化に。 |
| **3** | `C <- A`, `B1 <- A`, `B2 <- A` | `C + B2` (X), `B1` (Y) | `A` | 1つのモジュレーター A が C/B1/B2 すべてを変調。広がりあるコード・パッド向け。 |
| **4** | `C <- A <- B1 <- B2` | `C` (X), `B1` (Y) | `B2` | 4段直列 FM。極めて金属的で複雑なパーカッションやインダストリアル音色に。 |
| **5** | `C <- B1 <- B2`, `A` (単独) | `C` (X), `A` (Y) | `B1` | 3段 FM + 単独キャリア A。アタックの鋭い音と持続音のブレンドに。 |
| **6** | `C <- A`, `B1 <- B2 + A` | `C` (X), `B1` (Y) | `A` | AがCとB1の双方を変調するクロス接続。豊かな厚みを持つリードやブラスに。 |
| **7** | なし（全並列キャリア） | `C + A + B2` (X), `B1` (Y) | `A` | 全オペレーターが直接出力。オルガン、加算合成、ドローンに。 |
| **8** | `C <- A`, `B1` (単独), `B2` (単独) | `C + B2` (X), `B1` (Y) | `B1` | 1系統 FM (C<-A) + 2つの並列サイン波。FMベースにサイン波のサブベースを足す用途などに。 |

---

## パラメータリファレンス

### 基本・音程パラメータ

| パラメータ | 短縮名 | 設定範囲 | デフォルト | 説明 |
| :--- | :--- | :--- | :--- | :--- |
| `note` | - | 文字列 / 数値 | `48` (C3) | ノート名（例: `'c3'`, `'eb4'`）または MIDI 番号 |
| `freq` | - | 数値 (Hz) | - | 周波数を直接指定する場合に使用 |
| `octave` | - | 整数 | `0` | オクターブシフト量 |
| `amp` | - | `0.0` 〜 `1.0`+ | `1.0` | ボイス全体の振幅ゲイン |
| `vol` | `volume` | `0` 〜 `127` | `100` | トラックボリューム |
| `pan` | - | `-64` 〜 `63` | `0` | ステレオ定位（-64: 左, 0: 中央, 63: 右） |
| `duration` | - | 数値 (秒) | `1.0` | 発音長。ノートオフと連動してオシレーターを停止 |

### FM シンセシス・オペレーターパラメータ

| パラメータ | 短縮名 | 設定範囲 | デフォルト | 説明 |
| :--- | :--- | :--- | :--- | :--- |
| `algo` | - | `1` 〜 `8` | `1` | FM アルゴリズム選択 |
| `ratioC` | `rc` | `0.01` 〜 | `1.0` | オペレーター C の周波数比率 |
| `ratioA` | `ra` | `0.01` 〜 | `1.0` | オペレーター A の周波数比率 |
| `ratioB` | `rb` | `0.01` 〜 | `1.0` | オペレーター B (B1 & B2) 共通の周波数比率 |
| `ratioB1` | - | `0.01` 〜 | `ratioB` | オペレーター B1 個別の周波数比率 |
| `ratioB2` | - | `0.01` 〜 | `ratioB` | オペレーター B2 個別の周波数比率 |
| `offsetC` | - | 数値 | `0.0` | オペレーター C の比率微調整オフセット |
| `offsetA` | - | 数値 | `0.0` | オペレーター A の比率微調整オフセット |
| `offsetB1` | - | 数値 | `0.0` | オペレーター B1 の比率微調整オフセット |
| `offsetB2` | - | 数値 | `0.0` | オペレーター B2 の比率微調整オフセット |
| `harm` | - | `-26` 〜 `26` | `0` | ハーモニクス（正: Op A/B1 の倍音モーフィング, 負: Op C の倍音モーフィング） |
| `dtun` | `detune` | `-11.99` 〜 `11.99` | `0` | デチューン量（半音単位、0.01ステップ。Op A 及び B2 に適用） |
| `fdbk` | `feedback` | `0` 〜 `127` | `0` | フィードバック量 |
| `mix` | - | `-64` 〜 `63` | `0` | オペレーター C 側 (X) と B1 側 (Y) の出力ミックスバランス |

### エンベロープ（オペレーター / ピッチ / アンプ）

#### オペレーター A & B エンベロープ (モジュレーション量)
各オペレーターのモジュレーション深さを時間変化させます。

| パラメータ | 設定範囲 | デフォルト | 説明 |
| :--- | :--- | :--- | :--- |
| `levA`, `levB` | `0` 〜 `127` | `64` | モジュレーションのピークレベル（`levB` は B1/B2 へのクロスフェードも兼ねる） |
| `atkA`, `atkB` | 秒 (`0.0005`〜) | `0.001` | モジュレーションのアタック時間 |
| `decA`, `decB` | 秒 (`0.001`〜) | `0.5` | モジュレーションのディケイ時間 |
| `endA`, `endB` | `0` 〜 `127` | `0` | サステイン/到達レベル |
| `adel`, `bdel` | 秒 (`0.0`〜) | `0.0` | エンベロープ開始ディレイ時間 |
| `atrg`, `btrg` | `0` または `1` | `1` | トリガー設定（1: ノートオンでトリガー, 0: フリーラン） |

#### ピッチエンベロープ
アタック時のピッチスイープ効果（キックのアタック感やエレクトロニックな急降下音）を作成します。

| パラメータ | 短縮名 | 設定範囲 | デフォルト | 説明 |
| :--- | :--- | :--- | :--- | :--- |
| `prate` | - | `0.01` 〜 | `1.0` | ピッチ変調倍率（例: 4.0 で 2オクターブ上から降下） |
| `patk` | - | 秒 | `0.0` | ピッチアタック時間 |
| `plen` | - | 秒 | `0.1` | ピッチ減衰時間 |
| `pmode` | `pitch_mode` | `'carrier'` / `'all'` | `'carrier'` | ピッチエンベロープ適用対象（キャリアのみ、または全オペレーター） |

#### アンプエンベロープ (音量)
ボイス全体の最終的な音量カーブを設定します。

| パラメータ | 別名 | 設定範囲 | デフォルト | 説明 |
| :--- | :--- | :--- | :--- | :--- |
| `amp_atk` | `atk`, `attack` | 秒 (`0.0005`〜) | `0.001` | アタック時間 |
| `amp_dec` | `dec`, `decay` | 秒 (`0.001`〜) | `0.5` | ディケイ時間 |
| `amp_sus` | `sus`, `sustain` | `0` 〜 `127` / `0.0`〜`1.0` | `127` (`1.0`) | サステイン音量レベル |
| `amp_rel` | `rel`, `release` | 秒 (`0.001`〜) | `0.1` | リリース時間 |

### フィルター（Base-Width / Multimode）

音声信号は **FM 出力 -> Overdrive -> Base-Width フィルター -> Multimode フィルター** の順にルーティングされます。

#### 1. Base-Width フィルター
直感的な帯域制限（不要な低域を削り、帯域幅を決める）を行う Digitone 固有のフィルターです。実装: [createBaseWidthFilterNode](file:///Users/braveeeeen/dev/synthdef-port/strudel-out/strudel-digitone-clone.js#L1498)

| パラメータ | 設定範囲 | デフォルト | 説明 |
| :--- | :--- | :--- | :--- |
| `base` | `0` 〜 `127` | `0` | ハイパスのカットオフ周波数（0: 最低域 20Hz / 実質バイパス） |
| `width` | `0` 〜 `127` | `127` | 通過帯域幅（127: フルオープン 20000Hz） |

#### 2. マルチモードフィルター
レゾナンスと専用 ADSR エンベロープを備えた本格的なフィルターです。実装: [createMultimodeFilterNode](file:///Users/braveeeeen/dev/synthdef-port/strudel-out/strudel-digitone-clone.js#L1551)

| パラメータ | 別名 | 設定範囲 | デフォルト | 説明 |
| :--- | :--- | :--- | :--- | :--- |
| `fltr_type` | `ftype`, `fltType` | `'lpf'`, `'lpf2'`, `'hpf'`, `'off'` | `'lpf'` | フィルター種別 (1=LPF, 2=HPF, 3=LPF2 24dB/oct, 0=OFF) |
| `fltr_freq` | `ffreq`, `cutoff` | `20` 〜 `18000` (Hz) | `18000` (HPF時: `20`) | 基準カットオフ周波数 |
| `fltr_reso` | `freso`, `q` | `0` 〜 `127` | `0` | レゾナンス（Q値 0.707 〜 24.0 へ変換） |
| `fltr_env` | `fenv`, `fltEnv` | `-128` 〜 `127` | `0` | フィルターエンベロープの変調深度 |
| `fltr_atk` | `fatk` | 秒 | `0.001` | フィルターアタック時間 |
| `fltr_dec` | `fdec` | 秒 | `0.5` | フィルターディケイ時間 |
| `fltr_sus` | `fsus` | 周波数 (Hz) | `baseFreq` | フィルターサステイン周波数 |
| `fltr_rel` | `frel` | 秒 | `0.1` | フィルターリリース時間 |
| `fltr_del` | `fdel` | 秒 | `0.0` | フィルターエンベロープ開始ディレイ |

### オーバードライブ・パン・ボリューム

| パラメータ | 別名 | 設定範囲 | デフォルト | 説明 |
| :--- | :--- | :--- | :--- | :--- |
| `drv` | `overdrive` | `0` 〜 `127` | `0` | Digitone 特有の tanh ソフトクリッピング歪み（音量自動補正付き） |
| `pan` | - | `-64` 〜 `63` | `0` | ステレオパンニング |
| `vol` | `volume` | `0` 〜 `127` | `100` | マスターボリューム |

---

## サウンドデザイン・実践レシピ

### 1. ソリッドな Digitone FM ベース
低域をタイトに引き締め、モジュレーターのディケイを短くしてアタック感を強調したベースです。

```javascript
note("c2 [~ c2] eb2 [f2 g2]")
  .s("syn")
  .algo(1)
  .ratioC(1)
  .ratioA(2)
  .levA(95)
  .decA(0.18)
  .fdbk(25)
  .drv(30)
  .base(10)
  .width(85)
  .decay(0.35)
  .sustain(0)
  .play()
```

### 2. クリスタル FM エレピ / ベル
非整数倍音やデチューン、長めのリリースを活かしたきらびやかな金属系・鍵盤系サウンドです。

```javascript
note("<[c4,eb4,g4,bb4] [d4,f4,a4,c5]>")
  .s("syn")
  .algo(2)
  .ratioC(1)
  .ratioA(3.5)
  .ratioB(1)
  .ratioB1(7)
  .ratioB2(14)
  .levA(70)
  .levB(85)
  .harm(12)
  .dtun(4)
  .mix(10)
  .decay(1.2)
  .sustain(0.1)
  .release(1.5)
  .play()
```

### 3. 深みのある FM パッド
全並列または複数キャリアのアルゴリズム（Algo 3 / Algo 7）にデチューンとフィルターエンベロープを適用した豊かなパッドです。

```javascript
note("<[c3,g3,c4,eb4] [ab2,eb3,ab3,c4] [bb2,f3,bb3,d4]>")
  .s("syn")
  .algo(3)
  .ratioC(1)
  .ratioA(1)
  .ratioB(1)
  .dtun(6)
  .harm(6)
  .levA(50)
  .attack(0.6)
  .decay(1.5)
  .sustain(0.7)
  .release(1.8)
  .fltr_type("lpf2")
  .fltr_freq(1200)
  .fltr_reso(20)
  .fltr_env(40)
  .fltr_atk(0.8)
  .play()
```

### 4. インダストリアル FM パーカッション
4段直列モジュレーション（Algo 4）とピッチエンベロープ、オーバードライブを組み合わせたインダストリアルな打楽器サウンドです。

```javascript
note("c1*4")
  .s("syn")
  .algo(4)
  .ratioA(1.5)
  .ratioB1(4.25)
  .ratioB2(7.1)
  .fdbk(110)
  .levA(115)
  .levB(120)
  .prate(6)
  .plen(0.04)
  .drv(70)
  .decay(0.12)
  .sustain(0)
  .play()
```

### 5. アルゴリズムとハーモニクスをモーフィングするシーケンス
Strudel のパターン機能をフルに活かし、ステップごとに FM アルゴリズムや倍音構成を動的に変化させる例です。

```javascript
note("c3 eb3 f3 g3 bb3 c4 eb4 g4")
  .s("syn")
  .algo("<1 2 4 6>")
  .harm("<0 8 16 -12>")
  .fdbk("<20 60 90 40>")
  .levA("<60 90 120 40>")
  .drv("<10 30 60 20>")
  .decay(0.25)
  .sustain(0)
  .play()
```

---

## 関連ソース・ドキュメント

- コア実装: [strudel-out/strudel-digitone-clone.js](file:///Users/braveeeeen/dev/synthdef-port/strudel-out/strudel-digitone-clone.js)
- 音声再生メインルーチン: [playDigitoneSynVoice](file:///Users/braveeeeen/dev/synthdef-port/strudel-out/strudel-digitone-clone.js#L1751)
- アルゴリズムルーティング: [getDigitoneAlgorithm](file:///Users/braveeeeen/dev/synthdef-port/strudel-out/strudel-digitone-clone.js#L1435)
- テストスイート: [strudel-out/digitone-fm.test.js](file:///Users/braveeeeen/dev/synthdef-port/strudel-out/digitone-fm.test.js)
