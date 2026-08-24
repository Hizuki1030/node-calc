# CSVテーブル変換 デバッグデータ

- `dcdc_efficiency_1d.csv`: 1入力の線形補間確認用。
- `dcdc_efficiency_grid.csv`: 入力電圧×出力電流の完全な2次元格子。双線形補間確認用。
- `dcdc_efficiency_3d_temperature.csv`: 入力電圧×出力電流×温度の3入力補間確認用。
- `dcdc_efficiency_sparse.csv`: 格子点が欠けた散布データ。周辺点補間へのフォールバック確認用。
- `dcdc_efficiency_invalid_rows.csv`: 空欄・文字列入り。不正行の除外確認用（6行を採用、3行を除外）。

確認例:

- `dcdc_efficiency_grid.csv` の補間モードで入力電圧 `7 V`、出力電流 `0.75 A` → `87.25 %`。
- 同じ入力を最近傍モードにすると、同距離時はCSVで先にある `5 V / 0.5 A` → `84.0 %`。
- `dcdc_efficiency_1d.csv` の補間モードで出力電流 `0.75 A` → `90.0 %`。
- `dcdc_efficiency_3d_temperature.csv` の補間モードで `8.5 V / 1.5 A / 25 ℃` → `90.5 %`。
- 表の範囲外は外挿せず、各入力軸の端へ固定される。

値はすべて機能確認用の架空データで、実在製品の特性ではありません。
