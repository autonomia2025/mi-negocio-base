import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  pdf,
} from "@react-pdf/renderer";
import React from "react";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta_debito: "Tarjeta de débito",
  tarjeta_credito: "Tarjeta de crédito",
  credito: "Crédito directo",
  mixto: "Mixto",
  otro: "Otro",
};

type Sale = {
  id: string;
  tenant_id: string;
  sale_number: number;
  customer_name: string | null;
  customer_email: string | null;
  payment_method: string;
  subtotal: number;
  total: number;
  notes: string | null;
  created_at: string;
  created_by: string;
};

type Item = {
  id: string;
  product_sku_at_sale: string;
  product_name_at_sale: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
};

type Tenant = {
  id: string;
  name: string;
  settings: Record<string, unknown> | null;
};

type Business = {
  logo_url?: string;
  rfc?: string;
  direccion?: string;
  telefono?: string;
};

type Operations = { moneda?: string };

function getBusiness(t: Tenant | null): Business {
  const s = t?.settings as Record<string, unknown> | null;
  if (!s) return {};
  const b = s.business;
  return (b && typeof b === "object" ? (b as Business) : {}) ?? {};
}

function getCurrency(t: Tenant | null): string {
  const s = t?.settings as Record<string, unknown> | null;
  const ops = (s?.operations as Operations | undefined) ?? {};
  const m = ops.moneda;
  return m === "USD" || m === "EUR" || m === "MXN" ? m : "MXN";
}

function fmtCurrency(value: number, currency: string): string {
  const n = Number.isFinite(value) ? value : 0;
  // Manual formatting since Intl in workers may not have full locale; keep simple.
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const parts = abs.toFixed(2).split(".");
  const intStr = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${intStr}.${parts[1]} ${currency}`;
}

function fmtNumber(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return n.toFixed(2);
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  page: {
    padding: 43, // 0.6 in
    fontSize: 10,
    color: "#000",
    fontFamily: "Helvetica",
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  brand: { flexDirection: "column", maxWidth: 280 },
  logo: { width: 80, height: 80, marginBottom: 6, objectFit: "contain" },
  brandName: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  brandLine: { fontSize: 9, color: "#222", marginTop: 2 },
  docTitle: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "right" },
  divider: { borderBottomWidth: 1, borderBottomColor: "#000", marginVertical: 8 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  infoBlock: { flexDirection: "column", maxWidth: "48%" },
  label: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  value: { fontSize: 10 },
  table: { marginTop: 6 },
  th: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    paddingVertical: 4,
  },
  td: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#999",
    paddingVertical: 3,
  },
  colSku: { width: "16%", fontSize: 9 },
  colName: { width: "44%", fontSize: 10 },
  colQty: { width: "10%", fontSize: 10, textAlign: "right", fontFamily: "Courier" },
  colPrice: { width: "15%", fontSize: 10, textAlign: "right", fontFamily: "Courier" },
  colImporte: { width: "15%", fontSize: 10, textAlign: "right", fontFamily: "Courier" },
  totals: { marginTop: 10, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 2 },
  totalLabel: { width: 110, textAlign: "right", marginRight: 8, fontSize: 10 },
  totalValue: { width: 120, textAlign: "right", fontFamily: "Courier", fontSize: 10 },
  totalGrand: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  payment: { marginTop: 16, fontSize: 10 },
  notes: { marginTop: 8, fontSize: 9, color: "#222" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 43,
    right: 43,
    fontSize: 8,
    color: "#666",
    textAlign: "center",
  },
  pageNumber: {
    position: "absolute",
    bottom: 24,
    right: 43,
    fontSize: 8,
    color: "#666",
  },
});

function SalePdfDoc(props: {
  sale: Sale;
  items: Item[];
  tenant: Tenant | null;
  salespersonName: string;
}) {
  const { sale, items, tenant, salespersonName } = props;
  const business = getBusiness(tenant);
  const currency = getCurrency(tenant);
  const generated = fmtDateTime(new Date().toISOString());

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "LETTER", style: styles.page },
      // Header
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(
          View,
          { style: styles.brand },
          business.logo_url
            ? React.createElement(Image, { src: business.logo_url, style: styles.logo })
            : null,
          React.createElement(Text, { style: styles.brandName }, tenant?.name ?? ""),
          business.direccion
            ? React.createElement(Text, { style: styles.brandLine }, business.direccion)
            : null,
          business.rfc
            ? React.createElement(Text, { style: styles.brandLine }, `RFC: ${business.rfc}`)
            : null,
          business.telefono
            ? React.createElement(Text, { style: styles.brandLine }, `Tel: ${business.telefono}`)
            : null,
        ),
        React.createElement(
          View,
          null,
          React.createElement(Text, { style: styles.docTitle }, "COMPROBANTE DE VENTA"),
          React.createElement(
            Text,
            { style: { fontSize: 10, textAlign: "right", marginTop: 4 } },
            `Folio #${sale.sale_number}`,
          ),
        ),
      ),
      React.createElement(View, { style: styles.divider }),
      // Sale + customer info
      React.createElement(
        View,
        { style: styles.infoRow },
        React.createElement(
          View,
          { style: styles.infoBlock },
          React.createElement(Text, { style: styles.label }, "Datos de la venta"),
          React.createElement(
            Text,
            { style: styles.value },
            `Fecha: ${fmtDateTime(sale.created_at)}`,
          ),
          React.createElement(Text, { style: styles.value }, `Atendió: ${salespersonName}`),
        ),
        React.createElement(
          View,
          { style: styles.infoBlock },
          React.createElement(Text, { style: styles.label }, "Cliente"),
          React.createElement(
            Text,
            { style: styles.value },
            sale.customer_name ?? "Público general",
          ),
          React.createElement(Text, { style: styles.value }, sale.customer_email ?? "—"),
        ),
      ),
      React.createElement(View, { style: styles.divider }),
      // Items table
      React.createElement(
        View,
        { style: styles.table },
        React.createElement(
          View,
          { style: styles.th },
          React.createElement(Text, { style: { ...styles.colSku, fontFamily: "Helvetica-Bold" } }, "SKU"),
          React.createElement(Text, { style: { ...styles.colName, fontFamily: "Helvetica-Bold" } }, "Descripción"),
          React.createElement(Text, { style: { ...styles.colQty, fontFamily: "Helvetica-Bold" } }, "Cant."),
          React.createElement(Text, { style: { ...styles.colPrice, fontFamily: "Helvetica-Bold" } }, "P.U."),
          React.createElement(Text, { style: { ...styles.colImporte, fontFamily: "Helvetica-Bold" } }, "Importe"),
        ),
        ...items.map((item) =>
          React.createElement(
            View,
            { key: item.id, style: styles.td },
            React.createElement(Text, { style: styles.colSku }, item.product_sku_at_sale),
            React.createElement(Text, { style: styles.colName }, item.product_name_at_sale),
            React.createElement(Text, { style: styles.colQty }, fmtNumber(Number(item.quantity))),
            React.createElement(Text, { style: styles.colPrice }, fmtCurrency(Number(item.unit_price), currency)),
            React.createElement(Text, { style: styles.colImporte }, fmtCurrency(Number(item.line_subtotal), currency)),
          ),
        ),
      ),
      React.createElement(View, { style: styles.divider }),
      // Totals
      React.createElement(
        View,
        { style: styles.totals },
        React.createElement(
          View,
          { style: styles.totalRow },
          React.createElement(Text, { style: styles.totalLabel }, "Subtotal:"),
          React.createElement(Text, { style: styles.totalValue }, fmtCurrency(Number(sale.subtotal), currency)),
        ),
        React.createElement(
          View,
          { style: styles.totalRow },
          React.createElement(
            Text,
            { style: { ...styles.totalLabel, ...styles.totalGrand } },
            "Total:",
          ),
          React.createElement(
            Text,
            { style: { ...styles.totalValue, ...styles.totalGrand } },
            fmtCurrency(Number(sale.total), currency),
          ),
        ),
      ),
      // Payment
      React.createElement(
        Text,
        { style: styles.payment },
        `Método de pago: ${PAYMENT_LABELS[sale.payment_method] ?? sale.payment_method}`,
      ),
      sale.notes
        ? React.createElement(Text, { style: styles.notes }, `Notas: ${sale.notes}`)
        : null,
      // Footer
      React.createElement(
        Text,
        { style: styles.footer, fixed: true },
        `Generado el ${generated} · Este es un comprobante interno, no es una factura fiscal.`,
      ),
      React.createElement(Text, {
        style: styles.pageNumber,
        fixed: true,
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `Página ${pageNumber} de ${totalPages}`,
      }),
    ),
  );
}

export async function renderSalePdfBuffer(args: {
  sale: Sale;
  items: Item[];
  tenant: Tenant | null;
  salespersonName: string;
}): Promise<Uint8Array> {
  const doc = SalePdfDoc(args);
  const blob = await pdf(doc).toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}