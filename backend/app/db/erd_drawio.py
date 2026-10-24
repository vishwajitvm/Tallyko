"""Generate the draw.io database diagram (every table, every column) straight from the models.

    docker compose exec -T backend python -m app.db.erd_drawio > docs/diagrams/Tallyko_Database_ERD.drawio

Pages: "All tables" (grouped by area, every foreign key drawn) plus one page per area.
Header colour shows tenant isolation: teal = own tenant_id + RLS, light teal = RLS through its parent,
slate = global (platform) table that tenant sessions never see.
"""
import sys
import xml.etree.ElementTree as ET
from datetime import date

from sqlalchemy.dialects import postgresql

from app.models import Base

AREAS = [  # (module, title, blurb)
    ("accounts", "Accounts & sign-in", "Businesses, routing, platform logins, signed-in devices, subscription periods"),
    ("platform", "Tallyko platform", "Plans, subscription offers and payment claims, owner requests, platform settings and audit"),
    ("tax", "GST & tax", "Platform GST library (global) and each business's dated tax classes"),
    ("business", "Business setup & staff", "Locations, staff memberships, settings, counters, brands, sales channels"),
    ("access", "Roles & activity log", "Custom roles and the append-only audit log"),
    ("catalog", "Menu", "Categories, products, variants and the append-only product version history"),
    ("sales", "Floor, orders & payments", "Tables, customers, orders (bills), KOTs, order items with GST snapshot, payments"),
    ("inventory", "Inventory", "Stock movements"),
    ("marketing", "Offers & email", "Offers, redemptions, email templates and the email queue"),
]

ROW_H = 22
HEAD_H = 30
TABLE_W = 330
GAP_X = 50
GAP_Y = 40
AREA_PAD = 30
AREA_COLS = 4

HEADER = {
    "tenant": ("#CCFBF1", "#0F766E"),   # own tenant_id + RLS
    "child": ("#E6FFFA", "#14B8A6"),    # RLS via parent row
    "global": ("#E2E8F0", "#475569"),   # platform table
}


def table_area() -> dict:
    """table name -> model module (area)."""
    out = {}
    for mapper in Base.registry.mappers:
        table = mapper.local_table
        if table is not None:
            out[table.name] = mapper.class_.__module__.rsplit(".", 1)[-1]
    return out


def table_doc() -> dict:
    out = {}
    for mapper in Base.registry.mappers:
        doc = (mapper.class_.__doc__ or "").strip().splitlines()
        if mapper.local_table is not None and doc:
            out[mapper.local_table.name] = doc[0]
    return out


def rls_kind(table) -> str:
    return table.info.get("rls") or "global"


def col_type(col) -> str:
    try:
        text = col.type.compile(dialect=postgresql.dialect())
    except Exception:  # noqa: BLE001 - custom types without a compiler
        text = type(col.type).__name__
    text = text.lower().replace("timestamp without time zone", "timestamp")
    return text if len(text) <= 26 else text[:24] + "…"


def row_label(col) -> str:
    tags = []
    if col.primary_key:
        tags.append('<font color="#B45309"><b>PK</b></font>')
    fks = list(col.foreign_keys)
    if fks:
        tags.append('<font color="#1D4ED8"><b>FK</b></font>')
    if col.unique and not col.primary_key:
        tags.append('<font color="#7C3AED"><b>UQ</b></font>')
    name = f"<b>{col.name}</b>" if not col.nullable else col.name
    ref = ""
    if fks:
        fk = fks[0]
        ref = f' <font color="#1D4ED8">→ {fk.column.table.name}</font>'
    prefix = " ".join(tags)
    return (f'{prefix + " " if prefix else ""}{name} '
            f'<font color="#64748B">{col_type(col)}</font>{ref}')


class Page:
    def __init__(self, name: str, pid: str):
        self.diagram = ET.Element("diagram", id=pid, name=name)
        model = ET.SubElement(self.diagram, "mxGraphModel", dx="1600", dy="1000", grid="1", gridSize="10",
                              guides="1", tooltips="1", connect="1", arrows="1", fold="1", page="1",
                              pageScale="1", pageWidth="1654", pageHeight="1169", math="0", shadow="0")
        self.root = ET.SubElement(model, "root")
        ET.SubElement(self.root, "mxCell", id="0")
        ET.SubElement(self.root, "mxCell", id="1", parent="0")
        self.layer = "1"
        self.pid = pid
        self.row_ids: dict = {}  # (table, column) -> cell id

    def cell(self, cid, value, style, x, y, w, h, parent=None, vertex=True, tooltip=None):
        attrs = {"id": cid, "style": style, "parent": parent or self.layer}
        if vertex:
            attrs["vertex"] = "1"
        if tooltip:
            obj = ET.SubElement(self.root, "object", id=cid, label=value, tooltip=tooltip)
            attrs.pop("id")
            c = ET.SubElement(obj, "mxCell", attrs)
        else:
            attrs["value"] = value
            c = ET.SubElement(self.root, "mxCell", attrs)
        ET.SubElement(c, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
        return cid

    def table(self, table, x, y, doc=None):
        fill, stroke = HEADER[rls_kind(table)]
        tid = f"{self.pid}-t-{table.name}"
        kind = {"tenant": "RLS · tenant_id", "child": f"RLS via {table.info.get('rls_parent', 'parent')}",
                "global": "global"}[rls_kind(table)]
        cols = list(table.columns)
        height = HEAD_H + ROW_H * len(cols) + 6
        style = (f"swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize={HEAD_H};horizontalStack=0;"
                 f"resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=6;html=1;"
                 f"fillColor={fill};strokeColor={stroke};rounded=1;arcSize=6;swimlaneFillColor=#FFFFFF;fontSize=13;")
        label = f'{table.name} <font style="font-size:10px" color="#475569">({kind})</font>'
        self.cell(tid, label, style, x, y, TABLE_W, height, tooltip=doc)
        row_style = ("text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=8;spacingRight=4;"
                     "overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;html=1;fontSize=11;")
        for i, col in enumerate(cols):
            rid = f"{tid}-c{i}"
            self.cell(rid, row_label(col), row_style, 0, HEAD_H + ROW_H * i, TABLE_W, ROW_H, parent=tid)
            self.row_ids[(table.name, col.name)] = rid
        return height

    def area(self, title, blurb, x, y, w, h):
        style = ("rounded=1;arcSize=2;whiteSpace=wrap;html=1;fillColor=#F8FAFC;strokeColor=#CBD5E1;dashed=1;"
                 "verticalAlign=top;align=left;spacingLeft=14;spacingTop=8;fontSize=16;fontStyle=1;container=0;")
        label = f'{title}<br><font style="font-size:11px;font-weight:normal" color="#64748B">{blurb}</font>'
        self.cell(f"{self.pid}-a-{title}", label, style, x, y, w, h)

    def edges(self, tables):
        names = {t.name for t in tables}
        style = ("edgeStyle=entityRelationEdgeStyle;fontSize=11;html=1;endArrow=ERmandOne;startArrow=ERmany;"
                 "endFill=0;startFill=0;strokeColor=#94A3B8;rounded=1;")
        n = 0
        for t in tables:
            for col in t.columns:
                for fk in col.foreign_keys:
                    target = fk.column.table.name
                    if target not in names:
                        continue
                    src = self.row_ids.get((t.name, col.name))
                    dst = self.row_ids.get((target, fk.column.name))
                    if not (src and dst):
                        continue
                    n += 1
                    e = ET.SubElement(self.root, "mxCell", id=f"{self.pid}-e{n}", value="", style=style,
                                      edge="1", parent=self.layer, source=src, target=dst)
                    ET.SubElement(e, "mxGeometry", relative="1", **{"as": "geometry"})
        return n

    def note(self, cid, html, x, y, w, h):
        style = ("rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#CBD5E1;align=left;verticalAlign=top;"
                 "spacing=10;fontSize=12;")
        self.cell(cid, html, style, x, y, w, h)


def place(page, tables, x0, y0, cols, docs):
    """Shelf-pack tables into `cols` columns; returns (width, height) used."""
    heights = [0] * cols
    for t in tables:
        c = heights.index(min(heights))
        h = page.table(t, x0 + c * (TABLE_W + GAP_X), y0 + heights[c], docs.get(t.name))
        heights[c] += h + GAP_Y
    used_cols = min(cols, len(tables))
    return used_cols * (TABLE_W + GAP_X) - GAP_X, max(heights) - GAP_Y


def legend_html(total, fk_total):
    return (f"<b>Tallyko database: all {total} tables</b> (generated from the SQLAlchemy models on {date.today()})<br><br>"
            '<b>Header colour</b><br>'
            '<font color="#0F766E">■</font> teal: business table with its own <i>tenant_id</i>; Row-Level Security '
            "shows a business only its own rows<br>"
            '<font color="#14B8A6">■</font> light teal: RLS through its parent row (no tenant_id of its own)<br>'
            '<font color="#475569">■</font> slate: global platform table; tenant sessions never read it<br><br>'
            "<b>Rows</b>: <b>bold name</b> = required (NOT NULL); "
            '<font color="#B45309"><b>PK</b></font> primary key, <font color="#1D4ED8"><b>FK</b></font> foreign key '
            '(→ table), <font color="#7C3AED"><b>UQ</b></font> unique<br><br>'
            f"<b>Lines</b>: {fk_total} foreign keys, many → one. <i>tenant_id</i> is not a foreign key, so it draws no line; "
            "it ties every teal table to <i>global_vendors.id</i>.<br>"
            "The app's role <i>tallyko_app</i> cannot DELETE business records and cannot change "
            "<i>audit_logs</i> or <i>product_versions</i> (migration 0059). Hover a table for its description.<br>"
            "Regenerate: <i>docker compose exec -T backend python -m app.db.erd_drawio &gt; "
            "docs/diagrams/Tallyko_Database_ERD.drawio</i>")


def build() -> ET.Element:
    area_of = table_area()
    docs = table_doc()
    tables = sorted(Base.metadata.sorted_tables, key=lambda t: t.name)
    by_area = {m: [t for t in tables if area_of.get(t.name) == m] for m, _, _ in AREAS}
    unknown = [t for t in tables if area_of.get(t.name) not in by_area]
    if unknown:
        by_area.setdefault("other", []).extend(unknown)

    mxfile = ET.Element("mxfile", host="app.diagrams.net", type="device", version="24.7.17")

    # Page 1: everything
    page = Page("All tables", "all")
    y = 260
    for module, title, blurb in AREAS + ([("other", "Other", "")] if "other" in by_area else []):
        group = by_area.get(module) or []
        if not group:
            continue
        w, h = 0, 0
        top = y + 60
        w, h = place(page, group, 40 + AREA_PAD, top, AREA_COLS, docs)
        page.area(title, blurb, 40, y, max(w, TABLE_W) + 2 * AREA_PAD, h + 60 + AREA_PAD)
        # draw the area box behind its tables
        area_cell = page.root[-1]
        page.root.remove(area_cell)
        page.root.insert(2, area_cell)
        y += h + 60 + AREA_PAD + 60
    fk_total = page.edges(tables)
    page.note("all-legend", legend_html(len(tables), fk_total), 40, 20, 4 * (TABLE_W + GAP_X), 220)
    mxfile.append(page.diagram)

    # One page per area
    for module, title, blurb in AREAS:
        group = by_area.get(module) or []
        if not group:
            continue
        p = Page(title, f"p-{module}")
        p.note(f"p-{module}-n", f"<b>{title}</b>: {blurb}<br>"
               '<font color="#64748B">Teal = RLS (tenant), slate = global. Lines are foreign keys inside this area; '
               "→ marks a link to a table on another page.</font>", 40, 20, 3 * (TABLE_W + GAP_X), 60)
        place(p, group, 40, 110, 3, docs)
        p.edges(group)
        mxfile.append(p.diagram)
    return mxfile


def main() -> None:
    tree = build()
    ET.indent(tree, space="  ")
    sys.stdout.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    sys.stdout.write(ET.tostring(tree, encoding="unicode"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
