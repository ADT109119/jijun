## YYYY-MM-DD - Widget Settings and Balance Adjustment
**Feature:** Added Search to records, balance adjustment to accounts, and improved widget settings with SortableJS
**Learning:** Remember to use the `hiddenWidgets` array parallel to `widgetOrder` to avoid wiping out unseen widgets during drag-and-drop actions. Also, explicitly handle saving hidden widgets via DataService.
**Prevention:** Thoroughly verify that hidden items are handled gracefully when updating lists array.
