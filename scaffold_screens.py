import os

features = [
    ("002_catalog", "CatalogScreen"),
    ("003_billing", "BillingScreen"),
    ("004_table_mgmt", "TableMgmtScreen"),
    ("005_kot_kds", "KdsScreen"),
    ("006_barcode_variants", "InventoryScreen"),
    ("007_inventory", "StockScreen"),
    ("008_qr_menu", "QrMenuScreen"),
    ("009_crm_loyalty", "CrmScreen"),
    ("010_analytics", "AnalyticsScreen"),
    ("011_ai_upload", "AiUploadScreen"),
    ("012_online_store", "OnlineStoreScreen"),
]

screen_template = """import React from 'react';
import {{ View, Text, StyleSheet }} from 'react-native';
import {{ useTheme }} from '../../theme/ThemeContext';

export default function {component_name}() {{
  const {{ colors }} = useTheme();

  return (
    <View style={{[styles.container, {{ backgroundColor: colors.background }}]}}>
      <Text style={{[styles.text, {{ color: colors.text }}]}}>{component_name} - Coming Soon</Text>
    </View>
  );
}}

const styles = StyleSheet.create({{
  container: {{
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  }},
  text: {{
    fontSize: 20,
    fontWeight: 'bold',
  }}
}});
"""

base_dir = "c:/python/Tallyko/frontend/src"

for folder, component in features:
    folder_path = os.path.join(base_dir, folder)
    os.makedirs(folder_path, exist_ok=True)
    
    file_path = os.path.join(folder_path, f"{component}.js")
    with open(file_path, "w") as f:
        f.write(screen_template.format(component_name=component))

print("Frontend screens generated successfully.")
