/**
 * historicalReturns.js — #AB1-HIST 退休模擬「歷史重演」多市場報酬序列單一真相源
 *
 * 借鏡 Actual Budget v26.11.0 #9101：以真實連續歷史年份區塊抽樣取代純 i.i.d. 常態抽樣，
 * 保留多頭／熊市群聚、波動率聚集與報酬序列自相關（Sequence-of-Returns Risk）。
 *
 * 內建三組經官方數據驗證的年度總報酬（含股息再投資、名目小數值）：
 *   1. `taiex_tr`（預設）：台灣加權股價報酬指數（IR0001，2003–2025，23 年）
 *      — 臺灣證券交易所官方含息總報酬指數，等同 1 倍足額保證金台指期無限轉倉理論基準。
 *   2. `tw0050_tr`：元大台灣50（0050 含息總報酬，2004–2025，22 年）
 *      — 計入歷年除息再投資並還原 2025 年 1 拆 4 分割。
 *   3. `sp500_tr`：美股 S&P 500 年度總報酬（含股息再投資，1928–2025，98 年）
 *      — NYU Stern / Aswath Damodaran 公開長天期歷史序列，供極端情境壓力測試對照。
 */

export const DEFAULT_HISTORICAL_DATASET_ID = 'taiex_tr'

const BLOCK_MIN = 1
const BLOCK_MAX = 10
const BLOCK_DEFAULT = 5

function buildFrozenDataset(metaConfig, pairs) {
    const returns = Object.freeze(
        pairs.map(([year, returnRate]) => Object.freeze({ year, returnRate }))
    )
    const meta = Object.freeze({
        ...metaConfig,
        startYear: returns[0].year,
        endYear: returns[returns.length - 1].year,
        count: returns.length,
        defaultBlockSize: BLOCK_DEFAULT,
        minBlockSize: BLOCK_MIN,
        maxBlockSize: BLOCK_MAX,
    })
    return Object.freeze({ meta, returns })
}

export const HISTORICAL_RETURN_DATASETS = Object.freeze({
    taiex_tr: buildFrozenDataset(
        {
            id: 'taiex_tr',
            shortName: '台股加權報酬指數 (IR0001)',
            name: '台灣加權股價報酬指數（IR0001，含息／1x 台指期理論基準）',
            description:
                '臺灣證券交易所官方含息總報酬指數，等同 1 倍足額保證金台指期無限轉倉之理論基準（扣除正逆價差與轉倉摩擦前）',
            source: '臺灣證券交易所 MFI94U（2002/12/31 基期 4,452.45）',
            currency: 'TWD',
            nominal: true,
        },
        [
            [2003, 0.3524], [2004, 0.0759], [2005, 0.1094], [2006, 0.2444], [2007, 0.125],
            [2008, -0.4307], [2009, 0.8334], [2010, 0.1357], [2011, -0.1798], [2012, 0.1294],
            [2013, 0.1514], [2014, 0.1139], [2015, -0.0687], [2016, 0.1559], [2017, 0.1952],
            [2018, -0.0483], [2019, 0.2892], [2020, 0.2712], [2021, 0.2706], [2022, -0.1868],
            [2023, 0.3148], [2024, 0.3173], [2025, 0.2947],
        ]
    ),
    tw0050_tr: buildFrozenDataset(
        {
            id: 'tw0050_tr',
            shortName: '元大台灣50 (0050 含息)',
            name: '元大台灣50（0050 含息總報酬）',
            description:
                '追蹤臺灣 50 指數之指標型 ETF，計入歷年除息再投資並還原 2025 年 1 拆 4 分割',
            source: '臺灣證券交易所 0050 收盤價與除息資料（TWT49U）',
            currency: 'TWD',
            nominal: true,
        },
        [
            [2004, 0.0562], [2005, 0.1003], [2006, 0.2112], [2007, 0.1031], [2008, -0.4332],
            [2009, 0.75], [2010, 0.1313], [2011, -0.1581], [2012, 0.1192], [2013, 0.1168],
            [2014, 0.1666], [2015, -0.0628], [2016, 0.1965], [2017, 0.1814], [2018, -0.0494],
            [2019, 0.3352], [2020, 0.3114], [2021, 0.2192], [2022, -0.2137], [2023, 0.2752],
            [2024, 0.4864], [2025, 0.3686],
        ]
    ),
    sp500_tr: buildFrozenDataset(
        {
            id: 'sp500_tr',
            shortName: '美股 S&P 500（98 年長樣本）',
            name: 'S&P 500 年度總報酬（含股息再投資）',
            description:
                '涵蓋 1929 大蕭條、1970s 滯脹、2000 網路泡沫與 2008 金融海嘯，適合長天期極端壓力測試',
            source: 'NYU Stern / Damodaran S&P 500 Annual Total Returns',
            currency: 'USD',
            nominal: true,
        },
        [
            [1928, 0.4381], [1929, -0.0830], [1930, -0.2512], [1931, -0.4384], [1932, -0.0864],
            [1933, 0.4998], [1934, -0.0119], [1935, 0.4674], [1936, 0.3194], [1937, -0.3534],
            [1938, 0.2928], [1939, -0.0110], [1940, -0.1067], [1941, -0.1277], [1942, 0.1917],
            [1943, 0.2506], [1944, 0.1903], [1945, 0.3582], [1946, -0.0843], [1947, 0.0520],
            [1948, 0.0570], [1949, 0.1830], [1950, 0.3081], [1951, 0.2368], [1952, 0.1815],
            [1953, -0.0121], [1954, 0.5256], [1955, 0.3260], [1956, 0.0744], [1957, -0.1046],
            [1958, 0.4372], [1959, 0.1206], [1960, 0.0034], [1961, 0.2664], [1962, -0.0881],
            [1963, 0.2261], [1964, 0.1642], [1965, 0.1240], [1966, -0.0997], [1967, 0.2380],
            [1968, 0.1081], [1969, -0.0824], [1970, 0.0356], [1971, 0.1422], [1972, 0.1876],
            [1973, -0.1431], [1974, -0.2590], [1975, 0.3700], [1976, 0.2383], [1977, -0.0698],
            [1978, 0.0651], [1979, 0.1852], [1980, 0.3174], [1981, -0.0470], [1982, 0.2042],
            [1983, 0.2234], [1984, 0.0615], [1985, 0.3124], [1986, 0.1849], [1987, 0.0581],
            [1988, 0.1654], [1989, 0.3148], [1990, -0.0306], [1991, 0.3023], [1992, 0.0749],
            [1993, 0.0997], [1994, 0.0133], [1995, 0.3720], [1996, 0.2268], [1997, 0.3310],
            [1998, 0.2834], [1999, 0.2089], [2000, -0.0903], [2001, -0.1185], [2002, -0.2197],
            [2003, 0.2836], [2004, 0.1074], [2005, 0.0483], [2006, 0.1561], [2007, 0.0548],
            [2008, -0.3655], [2009, 0.2594], [2010, 0.1482], [2011, 0.0210], [2012, 0.1589],
            [2013, 0.3215], [2014, 0.1352], [2015, 0.0138], [2016, 0.1177], [2017, 0.2161],
            [2018, -0.0423], [2019, 0.3121], [2020, 0.1802], [2021, 0.2847], [2022, -0.1804],
            [2023, 0.2629], [2024, 0.2502], [2025, 0.1772],
        ]
    ),
})

/** 依推薦順序排列的所有內建歷史報酬資料集元資料清單 */
export const HISTORICAL_DATASET_LIST = Object.freeze([
    HISTORICAL_RETURN_DATASETS.taiex_tr.meta,
    HISTORICAL_RETURN_DATASETS.tw0050_tr.meta,
    HISTORICAL_RETURN_DATASETS.sp500_tr.meta,
])

/**
 * 依資料集 ID 取得對應的冷凍資料集物件（meta + returns）。
 * @param {string} [datasetId=DEFAULT_HISTORICAL_DATASET_ID]
 * @returns {{meta: object, returns: ReadonlyArray<Readonly<{year: number, returnRate: number}>>}}
 * @throws {Error} 傳入未知資料集 ID 時明確拒絕
 */
export function getHistoricalDataset(datasetId = DEFAULT_HISTORICAL_DATASET_ID) {
    const id =
        datasetId === null || datasetId === undefined || datasetId === ''
            ? DEFAULT_HISTORICAL_DATASET_ID
            : String(datasetId)
    const ds = HISTORICAL_RETURN_DATASETS[id]
    if (!ds) {
        throw new Error(`不支援的歷史報酬資料集：${String(datasetId)}`)
    }
    return ds
}

/** 預設歷史報酬序列（台灣加權股價報酬指數 IR0001） */
export const HISTORICAL_ANNUAL_RETURNS =
    HISTORICAL_RETURN_DATASETS[DEFAULT_HISTORICAL_DATASET_ID].returns

/** 預設歷史報酬資料集元資料（供向下相容引用） */
export const HISTORICAL_RETURN_META =
    HISTORICAL_RETURN_DATASETS[DEFAULT_HISTORICAL_DATASET_ID].meta

/**
 * 取得指定歷史資料集的年度總報酬率小數陣列（回傳新陣列複本，避免呼叫端污染內建序列）。
 * @param {string} [datasetId=DEFAULT_HISTORICAL_DATASET_ID]
 * @returns {number[]}
 */
export function getHistoricalReturnValues(
    datasetId = DEFAULT_HISTORICAL_DATASET_ID
) {
    return getHistoricalDataset(datasetId).returns.map(
        entry => entry.returnRate
    )
}

/**
 * 計算指定歷史報酬序列的描述性統計（算術平均、幾何年化、母體標準差、極值與對應年份）。
 * @param {string} [datasetId=DEFAULT_HISTORICAL_DATASET_ID]
 * @returns {{
 *   id: string,
 *   shortName: string,
 *   name: string,
 *   description: string,
 *   source: string,
 *   currency: string,
 *   count: number,
 *   startYear: number,
 *   endYear: number,
 *   mean: number,
 *   geometricMean: number,
 *   stdDev: number,
 *   min: number,
 *   max: number,
 *   minYear: number,
 *   maxYear: number
 * }}
 */
export function getHistoricalReturnStats(
    datasetId = DEFAULT_HISTORICAL_DATASET_ID
) {
    const { meta, returns: entries } = getHistoricalDataset(datasetId)
    const count = entries.length
    let sum = 0
    let logGrowthSum = 0
    let min = Infinity
    let max = -Infinity
    let minYear = entries[0].year
    let maxYear = entries[0].year

    for (const { year, returnRate } of entries) {
        sum += returnRate
        logGrowthSum += Math.log(1 + returnRate)
        if (returnRate < min) {
            min = returnRate
            minYear = year
        }
        if (returnRate > max) {
            max = returnRate
            maxYear = year
        }
    }

    const mean = sum / count
    const geometricMean = Math.exp(logGrowthSum / count) - 1

    let varianceSum = 0
    for (const { returnRate } of entries) {
        const diff = returnRate - mean
        varianceSum += diff * diff
    }
    const stdDev = Math.sqrt(varianceSum / count)

    return {
        id: meta.id,
        shortName: meta.shortName,
        name: meta.name,
        description: meta.description,
        source: meta.source,
        currency: meta.currency,
        count,
        startYear: meta.startYear,
        endYear: meta.endYear,
        mean,
        geometricMean,
        stdDev,
        min,
        max,
        minYear,
        maxYear,
    }
}
