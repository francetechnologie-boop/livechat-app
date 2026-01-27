import React from 'react';
import SupplierPanel from '../components/SupplierPanel.jsx';
import ExtractItemsPanel from '../components/ExtractItemsPanel.jsx';
import ItemsPanel from '../components/ItemsPanel.jsx';
import BomPanel from '../components/BomPanel.jsx';
import CollapsibleCard from '../components/CollapsibleCard.jsx';
import BomViewer from '../components/BomViewer.jsx';
import FxRatesPanel from '../components/FxRatesPanel.jsx';
import VendorImportPanel from '../components/VendorImportPanel.jsx';
import ProductMarginPanel from '../components/ProductMarginPanel.jsx';
import BomAssociatorPanel from '../components/BomAssociatorPanel.jsx';

export default function BomPage() {
  const [orgId, setOrgId] = React.useState('');
  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-semibold">Bill of Materials</h1>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <label htmlFor="orgId">Org ID</label>
          <input id="orgId" value={orgId} onChange={(e)=>setOrgId(e.target.value)} placeholder="optional"
                 className="border rounded px-2 py-1 text-sm" />
        </div>
      </div>

      <CollapsibleCard title="Suppliers" defaultOpen>
        <SupplierPanel orgId={orgId} />
      </CollapsibleCard>

      <CollapsibleCard title="Extract Items Data">
        <ExtractItemsPanel />
      </CollapsibleCard>

      <CollapsibleCard title="Items">
        <ItemsPanel orgId={orgId} />
      </CollapsibleCard>

      <CollapsibleCard title="Exchange Rates">
        <FxRatesPanel orgId={orgId} />
      </CollapsibleCard>

      <CollapsibleCard title="Vendor Import (staging)">
        <VendorImportPanel orgId={orgId} />
      </CollapsibleCard>

      <CollapsibleCard title="Bill of Material">
        <BomPanel orgId={orgId} />
      </CollapsibleCard>

      <CollapsibleCard title="BOM Viewer">
        <BomViewer orgId={orgId} />
      </CollapsibleCard>

      <CollapsibleCard title="Product Margin">
        <ProductMarginPanel orgId={orgId} />
      </CollapsibleCard>

      <CollapsibleCard title="BOM Associator">
        <BomAssociatorPanel orgId={orgId} />
      </CollapsibleCard>
    </div>
  );
}
