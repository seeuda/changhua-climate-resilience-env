# GIS_Portal 點位資料格式（GeoJSON）

本系統維持 GitHub Pages 可直接部署的靜態架構。新增環保局或其他業務點位時，原則上只需要：

1. 將點位 GeoJSON 放在 `GIS_Portal/` 下。
2. 在 `app.js` 的 `POINT_REGISTRY` 新增一組設定。
3. 重新整理頁面，左側「業務點位主題」會依 registry 顯示可切換圖層。

## GeoJSON 基本格式

點位資料應使用 `FeatureCollection`，座標順序為 `[經度, 緯度]`。

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [120.54321, 24.07654]
      },
      "properties": {
        "id": "ENV001",
        "name": "彰化縣清潔隊資源回收場",
        "town": "彰化市",
        "address": "彰化縣彰化市..."
      }
    }
  ]
}
```

## 必填欄位

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | string / number | 點位唯一識別碼，同一資料集內不可重複。 |
| `name` | string | 點位名稱，會顯示於 popup 與列表標題。 |
| `town` | string | 所在鄉鎮市，需與 `changhua_towns.json` 的 `town_name` 一致，才能正確篩選與辨識風險區。 |
| `address` | string | 地址或位置描述。 |

若既有資料欄位名稱不同，可在 `POINT_REGISTRY` 以 `idField`、`nameField`、`townField`、`addressField` 對應，不一定要改原始資料。

## 建議欄位

| 欄位 | 型別 | 顯示方式 | 說明 |
| --- | --- | --- | --- |
| `phone` | string | popup / 列表 | 聯絡電話。 |
| `work_type` | string | popup / 列表 / tag | 業務類型，例如清潔隊、資源回收、空污稽查、環境巡檢。 |
| `staff_count` | number | popup / 列表 | 工作人員、配置人力或可動員人數。 |
| `shade_info` | string | popup / 列表 | 遮蔭、降溫、戶外等待區或補水資訊。 |
| `risk_note` | string | popup / 列表 | 風險註記；有資料才顯示，適合描述淹水、高溫、交通或服務中斷風險。 |
| `adaptation_action` | string | popup / 列表 | 建議調適作為；有資料才顯示。 |
| `source_type` | string | popup / tag | 資料來源或業務分類。 |
| `updated_at` | string | popup | 資料更新日期，建議使用 `YYYY-MM-DD`。 |

## POINT_REGISTRY 設定範例

```js
const POINT_REGISTRY = {
  envFacilities: {
    id: 'envFacilities',
    label: '環保局業務點位',
    shortLabel: '環保',
    icon: 'fa-recycle',
    file: 'env_facilities.json',
    defaultVisible: false,
    idField: 'id',
    nameField: 'name',
    townField: 'town',
    addressField: 'address',
    countLabel: '環保點位',
    categoryFields: [
      { field: 'work_type', tagClass: 'tag-service' }
    ],
    popupFields: [
      { field: 'town', label: '所在鄉鎮' },
      { field: 'work_type', label: '業務類型' },
      { field: 'staff_count', label: '人力數', suffix: ' 人' },
      { field: 'shade_info', label: '遮蔭資訊' },
      { field: 'address', label: '地址' },
      { field: 'risk_note', label: '風險註記', type: 'risk' },
      { field: 'adaptation_action', label: '調適作為', type: 'action' }
    ],
    listFields: [
      { field: 'work_type', icon: 'fa-briefcase' },
      { field: 'staff_count', icon: 'fa-users', suffix: ' 人' },
      { field: 'shade_info', icon: 'fa-tree' },
      { field: 'risk_note', icon: 'fa-triangle-exclamation', type: 'risk' },
      { field: 'adaptation_action', icon: 'fa-screwdriver-wrench', type: 'action' },
      { field: 'address', icon: 'fa-map-location-dot' }
    ],
    marker: {
      color: '#22c55e'
    }
  }
};
```

## 顯示規則

- `popupFields` 與 `listFields` 中的欄位只有在值不為空時才顯示。
- `type: 'risk'` 會使用警示樣式，適合 `risk_note`。
- `type: 'action'` 會使用行動建議樣式，適合 `adaptation_action`。
- 點位外框會依目前啟用的氣候風險圖層與情境，讀取所在鄉鎮的風險等級渲染；第 4、5 級外框較粗。
- 啟用水利署淹水潛勢時，落在淹水潛勢區的點位會再以紅色警戒外框標示。

## 靜態部署注意事項

- GeoJSON 檔案路徑需與 `POINT_REGISTRY.file` 完全一致，包含大小寫。
- 本頁使用 `fetch()` 載入 GeoJSON，請用 GitHub Pages、Netlify、Vercel 或本機 HTTP server 測試，不建議直接以 `file://` 開啟。
- 本機測試可在 repo 根目錄執行：

```bash
python3 -m http.server 4173
```

再開啟 `http://127.0.0.1:4173/GIS_Portal/`。
