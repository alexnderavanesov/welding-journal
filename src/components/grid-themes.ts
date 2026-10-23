import { themeQuartz, themeAlpine, themeBalham } from 'ag-grid-community'

const BASE_THEME = themeQuartz.withParams({
  accentColor: '#0284c7', backgroundColor: '#ffffff', foregroundColor: '#334155',
  borderColor: '#e2e8f0', headerBackgroundColor: '#f7f9fc', headerTextColor: '#475569',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 13,
  headerFontSize: 12, headerFontWeight: 600, wrapperBorderRadius: 0,
  headerColumnResizeHandleColor: '#cbd5e1', headerColumnResizeHandleHeight: '40%',
  selectedRowBackgroundColor: '#e0f2fe', rangeSelectionBorderColor: '#0284c7',
  rowBorder: { width: 1, color: '#edf1f5' }, cellHorizontalPadding: 10,
})

/** Shared presentation; each grid keeps its own modules and business behavior. */
export const GRID_THEMES = {
  quartz: BASE_THEME,
  alpine: themeAlpine.withParams({ accentColor: '#16816a', backgroundColor: '#fff', foregroundColor: '#334155', headerBackgroundColor: '#eef4f1', headerTextColor: '#35534c', borderColor: '#d6e2dc', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 13, headerFontSize: 12, wrapperBorderRadius: 0, cellHorizontalPadding: 10, rowBorder: { width: 1, color: '#e8eeeb' } }),
  // Balham's default odd-row tint is translucent and exposes the scroll tile.
  // CSS controls optional stripes; every loaded row needs an opaque base.
  balham: themeBalham.withParams({ accentColor: '#52657b', backgroundColor: '#fff', oddRowBackgroundColor: { ref: 'dataBackgroundColor' }, foregroundColor: '#334155', headerBackgroundColor: '#e9edf2', headerTextColor: '#364152', borderColor: '#d4dbe4', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 13, headerFontSize: 12, wrapperBorderRadius: 0, cellHorizontalPadding: 10, rowBorder: { width: 1, color: '#e5e9ef' } }),
}
