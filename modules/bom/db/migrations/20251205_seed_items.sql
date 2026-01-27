-- Seed/Upsert items from embedded TSV (idempotent)
-- Columns: item_code, Reference, Description, description_short, Picture, Unit, Procurement_type

WITH raw(tsv) AS (
  VALUES ($$item_code	Reference	Description	description_short	Picture	Unit	Procurement_type
IT-000001	pH4.01/50ml	pH4.01 buffer solution color Red, accuracy ± 0.01pH (25°C), 50ml PET bottle with secure cap	PH4	ITEM_Images/IT-000001.Picture.093020.jpg	Piece	Acheté
IT-000002	pH7.00/50mlY	pH7.00 buffer solution color Yellow, accuracy ± 0.01pH (25°C), 50ml PET bottle with secure cap	PH7	ITEM_Images/IT-000002.Picture.092941.jpg	Piece	Acheté
IT-000003	pH9.00/50ml	pH9.00 buffer solution colorless, accuracy ± 0.02pH (25°C), 50ml PET bottle with secure cap	PH9	ITEM_Images/IT-000003.Picture.093115.jpg	Piece	Acheté
IT-000004	pH10.01/50ml	pH10.01 buffer solution color Blue, accuracy ± 0.02pH (25°C), 50ml PET bottle with secure cap	PH10	ITEM_Images/IT-000004.Picture.093317.jpg	Piece	Acheté
IT-000005	pH7,50/50ml	pH7.50 buffer solution colorless, accuracy ± 0.02pH (25°C), 50ml PET bottle with secure cap	PH7,5	ITEM_Images/IT-000005.Picture.093548.jpg	Piece	Acheté
IT-000006	RE650/50ml	650mV Redox/ORP buffer solution, accuracy ±5mV (25°C), 50ml PET bottle with secure cap.	650 mV	ITEM_Images/IT-000006.Picture.095114.jpg	Piece	Acheté
IT-000007	RE475/50ml	475mV Redox/ORP buffer solution, accuracy ±5mV (25°C), 50ml PET bottle with secure cap.	475 mV	ITEM_Images/IT-000007.Picture.095258.jpg	Piece	Acheté
IT-000008	KCl/50ml	Electrode storage solution, 50ml PET bottle with secure cap	STORAGE	ITEM_Images/IT-000008.Picture.092854.jpg	Piece	Acheté
IT-000009		ALI EXPRESS 12 mm / Blue Nylon Pneumatic Blanking Plug  (CZK)	Bouchon Blue	ITEM_Images/IT-000009.Picture.095511.jpg	Piece	Acheté
IT-000010	570728	Soaker Bottle Assembly, Standard Lab	Bottle	ITEM_Images/IT-000010.Picture.100417.jpg	Piece	Acheté
IT-000011	973087	S150CD/20ft/BNC, Black Cable, Blue Strain Relief, Clear Boot, Bulk Pack, For CZ	S150CD	ITEM_Images/IT-000011.Picture.054557.png	Piece	Acheté
IT-000012	SKL000173026	PV-13,5 kabelová vývodka WAPRO - Pg 13,5 , IP68, + matice + těsnící kroužek, šedá RAL 7035	PG13,5	ITEM_Images/IT-000012.Picture.100609.jpg	Piece	Acheté
IT-000013	PM011214E	Přípojka k zašroubování 12 mm  -1/2"	JoHN GUEST 1/2-12mm	ITEM_Images/IT-000013.Picture.100856.jpg	Piece	Acheté
IT-000014	S120C	pH Sensor, Bulb, Polymer, 9.5mm x 90mm; 3 m cable	S120C	ITEM_Images/IT-000014.Picture.101546.jpg	Piece	Acheté
IT-000015	PM011012E	Spojka k zašroubování 10mm 1/4"	JoHN GUEST 1/4-10mm	ITEM_Images/IT-000015.Picture.102307.jpg	Piece	Acheté
IT-000016		BOUCHON VISSABLE 80 mm	BOUCHON  80 mm	ITEM_Images/IT-000016.Picture.073922.jpg	Piece	Fabriqué
IT-000017		entretoise001	entretoise001	ITEM_Images/IT-000017.Picture.140053.jpg	Piece	Fabriqué
IT-000018		entretoise new _v1	entretoise new _v1	ITEM_Images/IT-000018.Picture.140133.jpg	Piece	Fabriqué
IT-000019	270047	O-kroužek NBR 70 ShA 12x2,5 Dichtomatik	O-RING 12*2,5	ITEM_Images/IT-000019.Picture.102555.jpg	Piece	Acheté
IT-000020		S150CD Type soleo	S150CD Type soleo	ITEM_Images/IT-000020.Picture.054648.png	Piece	Obselete
IT-000021	973083	S150CD-ORP 20ft(6mtr), BNC, black cable, yellow strain relief ,clear boot, Bulk pack	S150CD-ORP	ITEM_Images/IT-000021.Picture.054706.png	Piece	Acheté
IT-000022		S150CD-ORP Type soleo	S150CD-ORP Type soleo	ITEM_Images/IT-000022.Picture.054729.png	Piece	Obselete
IT-000023		Phoenix Contact 1411157 kabelová průchodka 1/2" NPT	PORTE-SONDE 1/2	ITEM_Images/IT-000023.Picture.143158.jpg	Piece	Acheté
IT-000024		S150CD MCX	S150CD MCX	ITEM_Images/IT-000024.Picture.054752.jpg	Piece	Fabriqué
IT-000025		S120C-ORP MCX	S120C-ORP MCX	ITEM_Images/IT-000025.Picture.054812.jpg	Piece	Fabriqué
IT-000026	S224C	pH Sensor, Spear Tip, Ultem, DJ, 1M, BNC-S224C	S224C	ITEM_Images/IT-000026.Picture.054841.jpg	Piece	Acheté
IT-000027	S224C-ORP	ORP Sensor, 12mm, Polymer, S8 13.5 Cap-S224C-ORP	S224CD-ORP	ITEM_Images/IT-000027.Picture.054911.jpg	Piece	Acheté
IT-000028		EMEC rondelle	EMEC rondelle	ITEM_Images/IT-000028.Picture.055041.jpg	Piece	Fabriqué
IT-000029	973186	S150CD-ORP-AU 20ft(6mtr), BNC, black cable, green top cap and strain relief, clear boot, Bulk pack	S150CD-ORP-GOLD	ITEM_Images/IT-000029.Picture.055103.jpg	Piece	Acheté
IT-000030	S120C-ORP	ORP Sensor, Pt, Polymer, 9.5mm x 90mm; 3 m cable	S120C-ORP	ITEM_Images/IT-000030.Picture.055359.jpg	Piece	Acheté
IT-000031		Bayrol003	Bayrol003	ITEM_Images/IT-000031.Picture.055449.jpg	Piece	Fabriqué
IT-000032		EZ001	EZ001	ITEM_Images/IT-000032.Picture.055512.jpg	Piece	Fabriqué
IT-000033	270049	O-kroužek NBR 70 ShA 12x3 Dichtomatik	O-RING 12*3	ITEM_Images/IT-000033.Picture.055554.jpg	Piece	Acheté
IT-000034	571050	DIN-EL connector	(DIN-EL connector)SN6	ITEM_Images/IT-000034.Picture.055750.png	Piece	Acheté
IT-000035	270425	O-kroužek NBR 70 ShA 12x4 Dichtomatik	O-RING 12*4	ITEM_Images/IT-000035.Picture.055850.jpg	Piece	Acheté
IT-000036		kaq2435b	kaq2435b	ITEM_Images/IT-000036.Picture.055930.jpg	Piece	Fabriqué
IT-000037		?	?	ITEM_Images/IT-000037.Picture.060002.jpg	Piece	Obselete
IT-000038		Null	Null		Piece	Obselete
IT-000039		bouchon pour étalonnage sonde 1/2	bouchon pour étalonnage sonde 1/2	ITEM_Images/IT-000039.Picture.060035.jpg	Piece	Obselete
IT-000040		PE Navrtávací třmen 20 mm x 1/2" PN10 - Polyetylen	20mm 1/2 "	ITEM_Images/IT-000040.Picture.145349.jpg	Piece	Acheté
IT-000041	UNI1019025002	PE Navrtávací třmen 25 mm x 1/2" PN10 - Polyetylen	25mm 1/2 "	ITEM_Images/IT-000041.Picture.145435.jpg	Piece	Acheté
IT-000042	UNI1019032002	PE Navrtávací třmen 32 mm x 1/2" PN10 - Polyetylen	32mm 1/2 "	ITEM_Images/IT-000042.Picture.145614.jpg	Piece	Acheté
IT-000043	UNI1019040002	PE Navrtávací třmen 40 mm x 1/2" PN10 - Polyetylen	40mm 1/2 "	ITEM_Images/IT-000043.Picture.145814.jpg	Piece	Acheté
IT-000044	UNI1019050002	PE Navrtávací třmen 50 mm x 1/2" PN10 - Polyetylen	50mm 1/2 "	ITEM_Images/IT-000044.Picture.150356.jpg	Piece	Acheté
IT-000045	UNI1019063002	PE Navrtávací třmen 63 mm x 1/2" PN10 - Polyetylen	63mm 1/2 "	ITEM_Images/IT-000045.Picture.150603.jpg	Piece	Acheté
IT-000046		Bouchon pour porte-sonde SEKO	Bouchon pour porte-sonde SEKO		Piece	Obselete
IT-000047		Porte sonde Zodiac pour R0819800 et R0819900	Porte sonde Zodiac pour R0819800 et R0819900		Piece	Obselete
IT-000048		Bouchon short	Bouchon short		Piece	Obselete
IT-000049	973271	S150CD 80 mm CD/20ft/BNC, Black Cable, Blue Strain Relief, Clear Boot, Bulk Pack, For CZ	S150CD-80mm	ITEM_Images/IT-000049.Picture.060135.png	Piece	Acheté
IT-000050	973272	S150CD-ORP  80 mm20ft(6mtr), BNC, black cable, yellow strain relief ,clear boot, Bulk pack	S150CD-ORP-80 mm	ITEM_Images/IT-000050.Picture.060150.png	Piece	Acheté
IT-000051	S420C-ORP/10/BTD	S420C-ORP/10/BTD	S420C-ORP/10/BTD	ITEM_Images/IT-000051.Picture.060259.jpg	Piece	Acheté
IT-000052	CAL-C110-pH	CAL-C110-pH	CAL-C110-pH	ITEM_Images/IT-000052.Picture.060340.jpg	Piece	Acheté
IT-000053		tvarový výsek (komplet ze 3 částí) -Large box -215*160*43 -160-1000 ks	Large box -215*160*43	ITEM_Images/IT-000053.Picture.151651.jpg	Piece	Acheté
IT-000054		tvarový výsek (komplet ze 3 částí) -Large box -215*160*43 -160-100 ks	F-Large box -215*160*43		Piece	Obselete
IT-000055		tvarový výsek (komplet ze 3 částí) -Small -205x80x40-160-300 ks	Smal box 205x80x40	ITEM_Images/IT-000055.Picture.151530.jpg	Piece	Obselete
IT-000056		tvarový výsek (komplet ze 3 částí) -Smal box -205x80x40 -160-300 ks	F-Smal box -205x80x40		Piece	Obselete
IT-000057	PM0810R	Uzavírací zátka JOHN GUEST, vnější průměr hrdla 10mm	JOHN GUEST-10mm	ITEM_Images/IT-000057.Picture.060538.jpg	Piece	Obselete
IT-000058	PM0812R	Uzavírací zátka JOHN GUEST, vnější průměr hrdla 12mm	JOHN GUEST-12mm	ITEM_Images/IT-000058.Picture.060600.jpg	Piece	Obselete
IT-000059		Label 700 mV-Qty 48	Label 700 mV-Qty 48	ITEM_Images/IT-000059.Picture.103024.jpg	Piece	Acheté
IT-000060		Label 465 mV-Qty 48	Label 465 mV-Qty 48	ITEM_Images/IT-000060.Picture.103106.jpg	Piece	Acheté
IT-000061		Label 468 mV-Qty 48	Label 468 mV-Qty 48	ITEM_Images/IT-000061.Picture.103145.jpg	Piece	Acheté
IT-000062		Label 470 mV-Qty 48	Label 470 mV-Qty 48	ITEM_Images/IT-000062.Picture.103224.jpg	Piece	Acheté
IT-000063		Label 240 mV-Qty 48	Label 240 mV-Qty 48	ITEM_Images/IT-000063.Picture.102929.jpg	Piece	Acheté
IT-000064		DOPRAVA	DOPRAVA		Piece	Obselete
IT-000065	RE200/50ml	200mV Redox/ORP buffer solution, accuracy ±5mV (25°C), 50ml PET bottle with secure cap.	200mV Redox	ITEM_Images/IT-000065.Picture.103309.jpg	Piece	Acheté
IT-000066		Label 220 mV-Qty 48	Label 220 mV-Qty 48		Piece	Acheté
IT-000067		Gaine thermo ROUGE	Gaine thermo ROUGE	ITEM_Images/IT-000067.Picture.064251.jpg	Milimeter	Acheté
IT-000068		Connecteur MCX	Connecteur MCX		Piece	Obselete
IT-000069		Montage type soleo PH	Mo. type soleo PH		Piece	Obselete
IT-000070		Montage type soleo ORP	Mo. type soleo ORP		Piece	Obselete
IT-000071		Montage type JOHN 12mm PH	Mo. type JOHN 12mm PH		Piece	Obselete
IT-000072		Montage type JOHN 12mm ORP	Mo. type JOHN 12mm ORP		Piece	Obselete
IT-000073		Montage type JOHN 12mm ORP-GOLD	Mo. JOHN 12mm ORP-GOLD		Piece	Obselete
IT-000074		Montage Orange ORP-GOLD	Mo. Orange ORP-GOLD		Piece	Obselete
IT-000075		Montage Orange ORP	Mo. Orange ORP		Piece	Obselete
IT-000076		Montage Orange pH	MoOrange pH		Piece	Obselete
IT-000077		SUB ASSY 80mm	Assy 80mm	ITEM_Images/IT-000077.Picture.085656.jpg	Piece	Sub_assy
IT-000078		ASSY S150CD-JOHN GUEST 12mm	Assy PH-JOHN 12mm	ITEM_Images/IT-000078.Picture.061153.png	Piece	Sub_assy
IT-000079		Assy S150CD-ORP Guest 12 mm	Assy ORP-JOHN 12mm	ITEM_Images/IT-000079.Picture.061210.png	Piece	Sub_assy
IT-000080		Assy S120C-John Guest 10mm	Assy PH-JOHN 10mm	ITEM_Images/IT-000080.Picture.061226.png	Piece	Sub_assy
IT-000081		Assy S120C-ORP-John Guest 10mm	Assy ORP-JOHN 10mm	ITEM_Images/IT-000081.Picture.061607.jpg	Piece	Sub_assy
IT-000082		Assy S150C-PG13.5 mounted	Assy S150C-PG13.5	ITEM_Images/IT-000082.Picture.061252.png	Piece	Sub_assy
IT-000083		Assy S150C-ORP-PG13.5 mounted	Assy S150C-ORP-PG13.5	ITEM_Images/IT-000083.Picture.061307.png	Piece	Sub_assy
IT-000084		Assy S150C- EMEC 	Assy S150C- EMEC 	ITEM_Images/IT-000084.Picture.061411.png	Piece	Sub_assy
IT-000085		Assy S150CD-ORP-EMEC	Assy S150CD-ORP-EMEC	ITEM_Images/IT-000085.Picture.061439.png	Piece	Sub_assy
IT-000086		Assy S150CD-ORP-ORANGE	Assy S150CD-ORP-ORANGE	ITEM_Images/IT-000086.Picture.061457.png	Piece	Sub_assy
IT-000087		Assy S150CD-ORANGE	Assy S150CD-ORANGE	ITEM_Images/IT-000087.Picture.061519.png	Piece	Sub_assy
IT-000088		Assy S150CD-GOLD-ORANGE	Assy S150CD-GOLD-ORANGE	ITEM_Images/IT-000088.Picture.061538.png	Piece	Sub_assy
IT-000089		Assy S150CD-GOLD Guest 12 mm	Assy S150CD-GOLD Guest 12 mm	ITEM_Images/IT-000089.Picture.061642.png	Piece	Sub_assy
IT-000090		Assy S150CD-SN6-ORANGE	Assy S150CD-SN6-ORANGE	ITEM_Images/IT-000090.Picture.061702.png	Piece	Sub_assy
IT-000091		Assy S150CD-GOLD-SN6-ORANGE	Assy S150CD-GOLD-SN6-ORANGE	ITEM_Images/IT-000091.Picture.061720.png	Piece	Sub_assy
IT-000092		Assy S150CD-GOLD-KAQ2435	Assy S150CD-GOLD-KAQ2435	ITEM_Images/IT-000092.Picture.061740.png	Piece	Sub_assy
IT-000093		Assy BOUCHON 1/2	Assy BOUCHON 1/2	ITEM_Images/IT-000093.Picture.061809.jpg	Piece	Sub_assy
IT-000094		assy S150CD-SOLEO	assy S150CD-SOLEO	ITEM_Images/IT-000094.Picture.061939.png	Piece	Sub_assy
IT-000095		assy S150CD-ORP-SOLEO	assy S150CD-ORP-SOLEO	ITEM_Images/IT-000095.Picture.061954.png	Piece	Sub_assy
IT-000096		Gaine thermo NOIR	Gaine thermo NOIR	ITEM_Images/IT-000096.Picture.064237.jpg	Milimeter	Acheté
IT-000097		assy S150CD-MCX	assy S150CD-MCX	ITEM_Images/IT-000097.Picture.062011.jpg	Piece	Sub_assy
IT-000098		Connecteur MCX	Connecteur MCX	ITEM_Images/IT-000098.Picture.064110.jpg	Piece	Acheté
IT-000099		Assy S120C-Guest 10mm-MCX	Assy S120C-Guest 10mm-MCX	ITEM_Images/IT-000099.Picture.062029.jpg	Piece	Obselete
IT-000100		Assy S120C-ORP-Guest10mm-MCX	Assy S120C-ORP-Guest10mm-MCX	ITEM_Images/IT-000100.Picture.062144.jpg	Piece	Sub_assy
IT-000101		220mV Redox/ORP buffer solution, accuracy ±5mV (25°C), 50ml PET bottle with secure cap.	220mV Redox	ITEM_Images/IT-000065.Picture.103309.jpg	Piece	Acheté
IT-000102		240mV Redox/ORP buffer solution, accuracy ±5mV (25°C), 50ml PET bottle with secure cap.	240mV Redox	ITEM_Images/IT-000065.Picture.103309.jpg	Piece	Acheté
IT-000103	270412	O-kroužek NBR 70 ShA 11x3 Dichtomatik	O-RING 11*3		Piece	Acheté
IT-000104	270046	O-kroužek NBR 70 ShA 12x2 Dichtomatik	O-RING 12*2		Piece	Acheté
IT-000105		CS200TC-K=0.1/10/TL	CS200TC-K=0.1/10/TL		Piece	Acheté
IT-000106		S8075CD-pH-Sensor, flach, Patrone, PPS, 3/4 'NPT			Piece	Acheté
IT-000107		B225-ORP Solution 225mV, 1 pint, Zobel	B225			Acheté
IT-000108		GT265-Glass body High-temp pH/ATC sensor, PTFE junction, double junction, KCL reserviour, 120 mm x 12 mm, VarioPin connector, Pt1000 Temp Comp	GT265			Acheté
IT-000109		GT101-Glass body pH sensor, PTFE junction, single junction, 120 mm x 12 mm, S8 connector	GT101			Acheté
IT-000110		S660CDHF - pH Sensor, Flat, CPVC, HF, Inline	S660CDHF			Acheté
IT-000111		S200C/BNC - pH Sensor, 12 mm, Polymer, 1M, BNC	S200C/BNC			Acheté
IT-000112		SKL000033741-SB M 6,4/3,2 MODRÁ BUŽÍRKA SMRŠŤOVACÍ POLYETYLEN	SKL000033741			Obselete
IT-000113		SKL000033746-SB R 3,2/1,6 RUDÁ BUŽÍRKA SMRŠŤOVACÍ POLYETYLEN	SKL000033746			Obselete
IT-000114		SKL000033728-SB Č 3,2/1,6 ČERNÁ BUŽÍRKA SMRŠŤOVACÍ POLYETYLEN	SKL000033728			Obselete
IT-000115	SKL000033730	SKL000033730-SB Č 4,8/2,4 ČERNÁ BUŽÍRKA SMRŠŤOVACÍ POLYETYLEN	SKL000033730			Acheté
IT-000116		MCX 90	MCX 90		Piece	Acheté
IT-000117		IS200CD-NO3-Comb DJ Nitrate ISE Probe, 12mm, 39 Inch (1M), BNC	IS200CD-NO3			Acheté
IT-000118		tvarový výsek (komplet ze 3 částí) -Small - 213 x 84 x 43 mm	Smal box 213x84x43mm	ITEM_Images/IT-000055.Picture.151530.jpg	Piece	Acheté
IT-000119	SKL000033726	SB M 4,8/2,4 modrá Bužírka smršťovací Polyetylen	SKL000033726			Acheté
IT-000120	SKL000033740	SB Č 2,4/1,2 černá Bužírka smršťovací Polyetylen	SKL000033740			Acheté
IT-000121	SKL000033745	SB R 2,4/1,2 rudá Bužírka smršťovací Polyetylen	SKL000033745			Acheté
IT-000122	TEST1-1	TEST2	TEST3	TEST4	TEST5	TEST6
IT-000123	S018	3.5M KCl/AgCl Gel, 6oz (150ml)	S018		TEST6	Acheté
IT-000124	SD7420CD	Differential pH Electrode, double-junction, 4-20mA Output, 20ft, TL 	SD7420CD		Piece	Acheté
IT-000125	S200C/BNC	S200C/BNC - pH Sensor, 12 mm, Polymer, 1M, BNC	S200C/BNC		Piece	Acheté
IT-000126	S662CD	S662CD-pH Sensor, Flat, CPVC, for 2'	S662CD-pH Sensor, Flat, CPVC, for 2'		Piece	Acheté
IT-000127	TX100	TX100	TX100		Piece	Acheté
IT-000128	S660CDHF	S660CDHF	S660CDHF		Piece	Acheté
IT-000129	S653/20/BNC	S653/20/BNC	S653/20/BNC		Piece	Acheté
IT-000130	S273CD		Comb pH Electrode with Hemi-pH Glass, 10ft,BNC		Piece	Acheté
IT-000131	GT111	GT111	GT111 -replacejment of PHER-DJ-112-SE		Piece	Acheté
IT-000132	BNC-WTP-8MMCB-CRP		Waterproof BNC Male Crimp Connector		Piece	Acheté
IT-000133	S450CD	pH Sensor, Flat, 15mm, Polymer, DJ	S450CD-pH sensor, flat, 15 mm, polymer, DJ		Piece	Acheté
IT-000134	S465C-ORP-AU	ORP Gold Electrode, No Cable, BNR Quick Disconnect	S465C-ORP-AU		Piece	Acheté
IT-000135	S354CD	pH Electrode, double-junction, epoxy body, flat tip, Din 13.5mm Cap, no cable	S354CD		Piece	Acheté
IT-000136	S290C	pH/ATC Electrode, single-junction, epoxy body, 30K, 8pin DIN (Orion® A, Hach® EC)	S290C		Piece	Acheté
IT-000137	S450C/BNC	pH Electrode, single-junction, epoxy body, 15 mm dia, 115 mm L	pH Electrode, single-junction, epoxy body, 15 mm dia, 115 mm L		Piece	Acheté
IT-000138	S350CD-ORP	S350CD-ORP	Comb ORP Electrode,		Piece	Acheté
IT-000139	S350CD	S350CD	pH Electrode, double-junction, epoxy body, flat tip		Piece	Acheté
IT-000140	SSRE	SSRE	Smart Sensors Remote Electronics, pH, 4-20mA, DIN Rail		Piece	Acheté
IT-000141	SSRE-P-MA/DR		SSRE-P-MA/DR /P - pH/MA - 4-20 mA/DR - DIN Rail			Acheté
IT-000142	SSRE-O-MA/DR		SSRE-O-MA/DR  -O - ORP/MA - 4-20 mA /DR - DIN Rail		Piece	Acheté$$)
)
, lines AS (
  SELECT regexp_split_to_table(replace(tsv, E'\r', ''), E'\n') AS line, generate_series(1, 10000) AS idx
    FROM raw
)
, parsed AS (
  SELECT
    nullif(btrim((string_to_array(line, E'\t'))[1]), '') AS item_code,
    nullif(btrim((string_to_array(line, E'\t'))[2]), '') AS reference,
    nullif(btrim((string_to_array(line, E'\t'))[3]), '') AS description,
    nullif(btrim((string_to_array(line, E'\t'))[4]), '') AS description_short,
    nullif(btrim((string_to_array(line, E'\t'))[5]), '') AS picture,
    nullif(btrim((string_to_array(line, E'\t'))[6]), '') AS unit,
    nullif(btrim((string_to_array(line, E'\t'))[7]), '') AS procurement_type
  FROM lines
)
, rows AS (
  SELECT * FROM parsed
  OFFSET 1 -- skip header
)
-- Insert missing items by sku=item_code
INSERT INTO mod_bom_items (org_id, sku, name, uom, attributes, code, reference, description, description_short, picture, unit, procurement_type, created_at, updated_at)
SELECT NULL,
       r.item_code,
       COALESCE(r.reference, r.description_short, r.description, r.item_code),
       COALESCE(r.unit, 'pcs'),
       '{}'::jsonb,
       r.item_code,
       r.reference,
       r.description,
       r.description_short,
       r.picture,
       r.unit,
       r.procurement_type,
       NOW(), NOW()
FROM rows r
WHERE r.item_code IS NOT NULL AND r.item_code <> ''
  AND NOT EXISTS (
    SELECT 1 FROM mod_bom_items i WHERE i.org_id IS NULL AND i.sku = r.item_code
  );

-- Update existing items
WITH raw2(tsv) AS (
  VALUES ($$item_code	Reference	Description	description_short	Picture	Unit	Procurement_type
IT-000001	pH4.01/50ml	pH4.01 buffer solution color Red, accuracy ± 0.01pH (25°C), 50ml PET bottle with secure cap	PH4	ITEM_Images/IT-000001.Picture.093020.jpg	Piece	Acheté
IT-000002	pH7.00/50mlY	pH7.00 buffer solution color Yellow, accuracy ± 0.01pH (25°C), 50ml PET bottle with secure cap	PH7	ITEM_Images/IT-000002.Picture.092941.jpg	Piece	Acheté
IT-000003	pH9.00/50ml	pH9.00 buffer solution colorless, accuracy ± 0.02pH (25°C), 50ml PET bottle with secure cap	PH9	ITEM_Images/IT-000003.Picture.093115.jpg	Piece	Acheté
IT-000004	pH10.01/50ml	pH10.01 buffer solution color Blue, accuracy ± 0.02pH (25°C), 50ml PET bottle with secure cap	PH10	ITEM_Images/IT-000004.Picture.093317.jpg	Piece	Acheté
IT-000005	pH7,50/50ml	pH7.50 buffer solution colorless, accuracy ± 0.02pH (25°C), 50ml PET bottle with secure cap	PH7,5	ITEM_Images/IT-000005.Picture.093548.jpg	Piece	Acheté
IT-000006	RE650/50ml	650mV Redox/ORP buffer solution, accuracy ±5mV (25°C), 50ml PET bottle with secure cap.	650 mV	ITEM_Images/IT-000006.Picture.095114.jpg	Piece	Acheté
IT-000007	RE475/50ml	475mV Redox/ORP buffer solution, accuracy ±5mV (25°C), 50ml PET bottle with secure cap.	475 mV	ITEM_Images/IT-000007.Picture.095258.jpg	Piece	Acheté
IT-000008	KCl/50ml	Electrode storage solution, 50ml PET bottle with secure cap	STORAGE	ITEM_Images/IT-000008.Picture.092854.jpg	Piece	Acheté
IT-000009		ALI EXPRESS 12 mm / Blue Nylon Pneumatic Blanking Plug  (CZK)	Bouchon Blue	ITEM_Images/IT-000009.Picture.095511.jpg	Piece	Acheté
IT-000010	570728	Soaker Bottle Assembly, Standard Lab	Bottle	ITEM_Images/IT-000010.Picture.100417.jpg	Piece	Acheté
IT-000011	973087	S150CD/20ft/BNC, Black Cable, Blue Strain Relief, Clear Boot, Bulk Pack, For CZ	S150CD	ITEM_Images/IT-000011.Picture.054557.png	Piece	Acheté
IT-000012	SKL000173026	PV-13,5 kabelová vývodka WAPRO - Pg 13,5 , IP68, + matice + těsnící kroužek, šedá RAL 7035	PG13,5	ITEM_Images/IT-000012.Picture.100609.jpg	Piece	Acheté
IT-000013	PM011214E	Přípojka k zašroubování 12 mm  -1/2"	JoHN GUEST 1/2-12mm	ITEM_Images/IT-000013.Picture.100856.jpg	Piece	Acheté
IT-000014	S120C	pH Sensor, Bulb, Polymer, 9.5mm x 90mm; 3 m cable	S120C	ITEM_Images/IT-000014.Picture.101546.jpg	Piece	Acheté
IT-000015	PM011012E	Spojka k zašroubování 10mm 1/4"	JoHN GUEST 1/4-10mm	ITEM_Images/IT-000015.Picture.102307.jpg	Piece	Acheté
IT-000016		BOUCHON VISSABLE 80 mm	BOUCHON  80 mm	ITEM_Images/IT-000016.Picture.073922.jpg	Piece	Fabriqué
IT-000017		entretoise001	entretoise001	ITEM_Images/IT-000017.Picture.140053.jpg	Piece	Fabriqué
IT-000018		entretoise new _v1	entretoise new _v1	ITEM_Images/IT-000018.Picture.140133.jpg	Piece	Fabriqué
IT-000019	270047	O-kroužek NBR 70 ShA 12x2,5 Dichtomatik	O-RING 12*2,5	ITEM_Images/IT-000019.Picture.102555.jpg	Piece	Acheté
IT-000020		S150CD Type soleo	S150CD Type soleo	ITEM_Images/IT-000020.Picture.054648.png	Piece	Obselete
IT-000021	973083	S150CD-ORP 20ft(6mtr), BNC, black cable, yellow strain relief ,clear boot, Bulk pack	S150CD-ORP	ITEM_Images/IT-000021.Picture.054706.png	Piece	Acheté
IT-000022		S150CD-ORP Type soleo	S150CD-ORP Type soleo	ITEM_Images/IT-000022.Picture.054729.png	Piece	Obselete
IT-000023		Phoenix Contact 1411157 kabelová průchodka 1/2" NPT	PORTE-SONDE 1/2	ITEM_Images/IT-000023.Picture.143158.jpg	Piece	Acheté
IT-000024		S150CD MCX	S150CD MCX	ITEM_Images/IT-000024.Picture.054752.jpg	Piece	Fabriqué
IT-000025		S120C-ORP MCX	S120C-ORP MCX	ITEM_Images/IT-000025.Picture.054812.jpg	Piece	Fabriqué
IT-000026	S224C	pH Sensor, Spear Tip, Ultem, DJ, 1M, BNC-S224C	S224C	ITEM_Images/IT-000026.Picture.054841.jpg	Piece	Acheté
IT-000027	S224C-ORP	ORP Sensor, 12mm, Polymer, S8 13.5 Cap-S224C-ORP	S224CD-ORP	ITEM_Images/IT-000027.Picture.054911.jpg	Piece	Acheté
IT-000028		EMEC rondelle	EMEC rondelle	ITEM_Images/IT-000028.Picture.055041.jpg	Piece	Fabriqué
IT-000029	973186	S150CD-ORP-AU 20ft(6mtr), BNC, black cable, green top cap and strain relief, clear boot, Bulk pack	S150CD-ORP-GOLD	ITEM_Images/IT-000029.Picture.055103.jpg	Piece	Acheté
IT-000030	S120C-ORP	ORP Sensor, Pt, Polymer, 9.5mm x 90mm; 3 m cable	S120C-ORP	ITEM_Images/IT-000030.Picture.055359.jpg	Piece	Acheté
IT-000031		Bayrol003	Bayrol003	ITEM_Images/IT-000031.Picture.055449.jpg	Piece	Fabriqué
IT-000032		EZ001	EZ001	ITEM_Images/IT-000032.Picture.055512.jpg	Piece	Fabriqué
IT-000033	270049	O-kroužek NBR 70 ShA 12x3 Dichtomatik	O-RING 12*3	ITEM_Images/IT-000033.Picture.055554.jpg	Piece	Acheté
IT-000034	571050	DIN-EL connector	(DIN-EL connector)SN6	ITEM_Images/IT-000034.Picture.055750.png	Piece	Acheté
IT-000035	270425	O-kroužek NBR 70 ShA 12x4 Dichtomatik	O-RING 12*4	ITEM_Images/IT-000035.Picture.055850.jpg	Piece	Acheté
IT-000036		kaq2435b	kaq2435b	ITEM_Images/IT-000036.Picture.055930.jpg	Piece	Fabriqué
IT-000037		?	?	ITEM_Images/IT-000037.Picture.060002.jpg	Piece	Obselete
IT-000038		Null	Null		Piece	Obselete
IT-000039		bouchon pour étalonnage sonde 1/2	bouchon pour étalonnage sonde 1/2	ITEM_Images/IT-000039.Picture.060035.jpg	Piece	Obselete
IT-000040		PE Navrtávací třmen 20 mm x 1/2" PN10 - Polyetylen	20mm 1/2 "	ITEM_Images/IT-000040.Picture.145349.jpg	Piece	Acheté
IT-000041	UNI1019025002	PE Navrtávací třmen 25 mm x 1/2" PN10 - Polyetylen	25mm 1/2 "	ITEM_Images/IT-000041.Picture.145435.jpg	Piece	Acheté
IT-000042	UNI1019032002	PE Navrtávací třmen 32 mm x 1/2" PN10 - Polyetylen	32mm 1/2 "	ITEM_Images/IT-000042.Picture.145614.jpg	Piece	Acheté
IT-000043	UNI1019040002	PE Navrtávací třmen 40 mm x 1/2" PN10 - Polyetylen	40mm 1/2 "	ITEM_Images/IT-000043.Picture.145814.jpg	Piece	Acheté
IT-000044	UNI1019050002	PE Navrtávací třmen 50 mm x 1/2" PN10 - Polyetylen	50mm 1/2 "	ITEM_Images/IT-000044.Picture.150356.jpg	Piece	Acheté
IT-000045	UNI1019063002	PE Navrtávací třmen 63 mm x 1/2" PN10 - Polyetylen	63mm 1/2 "	ITEM_Images/IT-000045.Picture.150603.jpg	Piece	Acheté
IT-000046		Bouchon pour porte-sonde SEKO	Bouchon pour porte-sonde SEKO		Piece	Obselete
IT-000047		Porte sonde Zodiac pour R0819800 et R0819900	Porte sonde Zodiac pour R0819800 et R0819900		Piece	Obselete
IT-000048		Bouchon short	Bouchon short		Piece	Obselete
IT-000049	973271	S150CD 80 mm CD/20ft/BNC, Black Cable, Blue Strain Relief, Clear Boot, Bulk Pack, For CZ	S150CD-80mm	ITEM_Images/IT-000049.Picture.060135.png	Piece	Acheté
IT-000050	973272	S150CD-ORP  80 mm20ft(6mtr), BNC, black cable, yellow strain relief ,clear boot, Bulk pack	S150CD-ORP-80 mm	ITEM_Images/IT-000050.Picture.060150.png	Piece	Acheté
IT-000051	S420C-ORP/10/BTD	S420C-ORP/10/BTD	S420C-ORP/10/BTD	ITEM_Images/IT-000051.Picture.060259.jpg	Piece	Acheté
IT-000052	CAL-C110-pH	CAL-C110-pH	CAL-C110-ph	ITEM_Images/IT-000052.Picture.060340.jpg	Piece	Acheté
IT-000053		tvarový výsek (komplet ze 3 částí) -Large box -215*160*43 -160-1000 ks	Large box -215*160*43	ITEM_Images/IT-000053.Picture.151651.jpg	Piece	Acheté
IT-000054		tvarový výsek (komplet ze 3 částí) -Large box -215*160*43 -160-100 ks	F-Large box -215*160*43		Piece	Obselete
IT-000055		tvarový výsek (komplet ze 3 částí) -Small -205x80x40-160-300 ks	Smal box 205x80x40	ITEM_Images/IT-000055.Picture.151530.jpg	Piece	Obselete
IT-000056		tvarový výsek (komplet ze 3 částí) -Smal box -205x80x40 -160-300 ks	F-Smal box -205x80x40		Piece	Obselete
IT-000057	PM0810R	Uzavírací zátka JOHN GUEST, vnější průměr hrdla 10mm	JOHN GUEST-10mm	ITEM_Images/IT-000057.Picture.060538.jpg	Piece	Obselete
IT-000058	PM0812R	Uzavírací zátka JOHN GUEST, vnější průměr hrdla 12mm	JOHN GUEST-12mm	ITEM_Images/IT-000058.Picture.060600.jpg	Piece	Obselete
IT-000059		Label 700 mV-Qty 48	Label 700 mV-Qty 48	ITEM_Images/IT-000059.Picture.103024.jpg	Piece	Acheté
IT-000060		Label 465 mV-Qty 48	Label 465 mV-Qty 48	ITEM_Images/IT-000060.Picture.103106.jpg	Piece	Acheté
IT-000061		Label 468 mV-Qty 48	Label 468 mV-Qty 48	ITEM_Images/IT-000061.Picture.103145.jpg	Piece	Acheté
IT-000062		Label 470 mV-Qty 48	Label 470 mV-Qty 48	ITEM_Images/IT-000062.Picture.103224.jpg	Piece	Acheté
IT-000063		Label 240 mV-Qty 48	Label 240 mV-Qty 48	ITEM_Images/IT-000063.Picture.102929.jpg	Piece	Acheté
IT-000064		DOPRAVA	DOPRAVA		Piece	Obselete
IT-000065	RE200/50ml	200mV Redox/ORP buffer solution, accuracy ±5mV (25°C), 50ml PET bottle with secure cap.	200mV Redox	ITEM_Images/IT-000065.Picture.103309.jpg	Piece	Acheté
IT-000066		Label 220 mV-Qty 48	Label 220 mV-Qty 48		Piece	Acheté
IT-000067		Gaine thermo ROUGE	Gaine thermo ROUGE	ITEM_Images/IT-000067.Picture.064251.jpg	Milimeter	Acheté
IT-000068		Connecteur MCX	Connecteur MCX		Piece	Obselete
IT-000069		Montage type soleo PH	Mo. type soleo PH		Piece	Obselete
IT-000070		Montage type soleo ORP	Mo. type soleo ORP		Piece	Obselete
IT-000071		Montage type JOHN 12mm PH	Mo. type JOHN 12mm PH		Piece	Obselete
IT-000072		Montage type JOHN 12mm ORP	Mo. type JOHN 12mm ORP		Piece	Obselete
IT-000073		Montage type JOHN 12mm ORP-GOLD	Mo. JOHN 12mm ORP-GOLD		Piece	Obselete
IT-000074		Montage Orange ORP-GOLD	Mo. Orange ORP-GOLD		Piece	Obselete
IT-000075		Montage Orange ORP	Mo. Orange ORP		Piece	Obselete
IT-000076		Montage Orange pH	MoOrange pH		Piece	Obselete
IT-000077		SUB ASSY 80mm	Assy 80mm	ITEM_Images/IT-000077.Picture.085656.jpg	Piece	Sub_assy
IT-000078		ASSY S150CD-JOHN GUEST 12mm	Assy PH-JOHN 12mm	ITEM_Images/IT-000078.Picture.061153.png	Piece	Sub_assy
IT-000079		Assy S150CD-ORP Guest 12 mm	Assy ORP-JOHN 12mm	ITEM_Images/IT-000079.Picture.061210.png	Piece	Sub_assy
IT-000080		Assy S120C-John Guest 10mm	Assy PH-JOHN 10mm	ITEM_Images/IT-000080.Picture.061226.png	Piece	Sub_assy
IT-000081		Assy S120C-ORP-John Guest 10mm	Assy ORP-JOHN 10mm	ITEM_Images/IT-000081.Picture.061607.jpg	Piece	Sub_assy
IT-000082		Assy S150C-PG13.5 mounted	Assy S150C-PG13.5	ITEM_Images/IT-000082.Picture.061252.png	Piece	Sub_assy
IT-000083		Assy S150C-ORP-PG13.5 mounted	Assy S150C-ORP-PG13.5	ITEM_Images/IT-000083.Picture.061307.png	Piece	Sub_assy
IT-000084		Assy S150C- EMEC 	Assy S150C- EMEC 	ITEM_Images/IT-000084.Picture.061411.png	Piece	Sub_assy
IT-000085		Assy S150CD-ORP-EMEC	Assy S150CD-ORP-EMEC	ITEM_Images/IT-000085.Picture.061439.png	Piece	Sub_assy
IT-000086		Assy S150CD-ORP-ORANGE	Assy S150CD-ORP-ORANGE	ITEM_Images/IT-000086.Picture.061457.png	Piece	Sub_assy
IT-000087		Assy S150CD-ORANGE	Assy S150CD-ORANGE	ITEM_Images/IT-000087.Picture.061519.png	Piece	Sub_assy
IT-000088		Assy S150CD-GOLD-ORANGE	Assy S150CD-GOLD-ORANGE	ITEM_Images/IT-000088.Picture.061538.png	Piece	Sub_assy
IT-000089		Assy S150CD-GOLD Guest 12 mm	Assy S150CD-GOLD Guest 12 mm	ITEM_Images/IT-000089.Picture.061642.png	Piece	Sub_assy
IT-000090		Assy S150CD-SN6-ORANGE	Assy S150CD-SN6-ORANGE	ITEM_Images/IT-000090.Picture.061702.png	Piece	Sub_assy
IT-000091		Assy S150CD-GOLD-SN6-ORANGE	Assy S150CD-GOLD-SN6-ORANGE	ITEM_Images/IT-000091.Picture.061720.png	Piece	Sub_assy
IT-000092		Assy S150CD-GOLD-KAQ2435	Assy S150CD-GOLD-KAQ2435	ITEM_Images/IT-000092.Picture.061740.png	Piece	Sub_assy
IT-000093		Assy BOUCHON 1/2	Assy BOUCHON 1/2	ITEM_Images/IT-000093.Picture.061809.jpg	Piece	Sub_assy
IT-000094		assy S150CD-SOLEO	assy S150CD-SOLEO	ITEM_Images/IT-000094.Picture.061939.png	Piece	Sub_assy
IT-000095		assy S150CD-ORP-SOLEO	assy S150CD-ORP-SOLEO	ITEM_Images/IT-000095.Picture.061954.png	Piece	Sub_assy
IT-000096		Gaine thermo NOIR	Gaine thermo NOIR	ITEM_Images/IT-000096.Picture.064237.jpg	Milimeter	Acheté
IT-000097		assy S150CD-MCX	assy S150CD-MCX	ITEM_Images/IT-000097.Picture.062011.jpg	Piece	Sub_assy
IT-000098		Connecteur MCX	Connecteur MCX	ITEM_Images/IT-000098.Picture.064110.jpg	Piece	Acheté
IT-000099		Assy S120C-Guest 10mm-MCX	Assy S120C-Guest 10mm-MCX	ITEM_Images/IT-000099.Picture.062029.jpg	Piece	Obselete
IT-000100		Assy S120C-ORP-Guest10mm-MCX	Assy S120C-ORP-Guest10mm-MCX	ITEM_Images/IT-000100.Picture.062144.jpg	Piece	Sub_assy
IT-000101		220mV Redox/ORP buffer solution, accuracy ±5mV (25°C), 50ml PET bottle with secure cap.	220mV Redox	ITEM_Images/IT-000065.Picture.103309.jpg	Piece	Acheté
IT-000102		240mV Redox/ORP buffer solution, accuracy ±5mV (25°C), 50ml PET bottle with secure cap.	240mV Redox	ITEM_Images/IT-000065.Picture.103309.jpg	Piece	Acheté
IT-000103	270412	O-kroužek NBR 70 ShA 11x3 Dichtomatik	O-RING 11*3		Piece	Acheté
IT-000104	270046	O-kroužek NBR 70 ShA 12x2 Dichtomatik	O-RING 12*2		Piece	Acheté
IT-000105		CS200TC-K=0.1/10/TL	CS200TC-K=0.1/10/TL		Piece	Acheté
IT-000106		S8075CD-pH-Sensor, flach, Patrone, PPS, 3/4 'NPT			Piece	Acheté
IT-000107		B225-ORP Solution 225mV, 1 pint, Zobel	B225			Acheté
IT-000108		GT265-Glass body High-temp pH/ATC sensor, PTFE junction, double junction, KCL reserviour, 120 mm x 12 mm, VarioPin connector, Pt1000 Temp Comp	GT265			Acheté
IT-000109		GT101-Glass body pH sensor, PTFE junction, single junction, 120 mm x 12 mm, S8 connector	GT101			Acheté
IT-000110		S660CDHF - pH Sensor, Flat, CPVC, HF, Inline	S660CDHF			Acheté
IT-000111		S200C/BNC - pH Sensor, 12 mm, Polymer, 1M, BNC	S200C/BNC			Acheté
IT-000112		SKL000033741-SB M 6,4/3,2 MODRÁ BUŽÍRKA SMRŠŤOVACÍ POLYETYLEN	SKL000033741			Obselete
IT-000113		SKL000033746-SB R 3,2/1,6 RUDÁ BUŽÍRKA SMRŠŤOVACÍ POLYETYLEN	SKL000033746			Obselete
IT-000114		SKL000033728-SB Č 3,2/1,6 ČERNÁ BUŽÍRKA SMRŠŤOVACÍ POLYETYLEN	SKL000033728			Obselete
IT-000115	SKL000033730	SKL000033730-SB Č 4,8/2,4 ČERNÁ BUŽÍRKA SMRŠŤOVACÍ POLYETYLEN	SKL000033730			Acheté
IT-000116		MCX 90	MCX 90		Piece	Acheté
IT-000117		IS200CD-NO3-Comb DJ Nitrate ISE Probe, 12mm, 39 Inch (1M), BNC	IS200CD-NO3			Acheté
IT-000118		tvarový výsek (komplet ze 3 částí) -Small - 213 x 84 x 43 mm	Smal box 213x84x43mm	ITEM_Images/IT-000055.Picture.151530.jpg	Piece	Acheté
IT-000119	SKL000033726	SB M 4,8/2,4 modrá Bužírka smršťovací Polyetylen	SKL000033726			Acheté
IT-000120	SKL000033740	SB Č 2,4/1,2 černá Bužírka smršťovací Polyetylen	SKL000033740			Acheté
IT-000121	SKL000033745	SB R 2,4/1,2 rudá Bužírka smršťovací Polyetylen	SKL000033745			Acheté
IT-000122	TEST1-1	TEST2	TEST3	TEST4	TEST5	TEST6
IT-000123	S018	3.5M KCl/AgCl Gel, 6oz (150ml)	S018		TEST6	Acheté
IT-000124	SD7420CD	Differential pH Electrode, double-junction, 4-20mA Output, 20ft, TL 	SD7420CD		Piece	Acheté
IT-000125	S200C/BNC	S200C/BNC - pH Sensor, 12 mm, Polymer, 1M, BNC	S200C/BNC		Piece	Acheté
IT-000126	S662CD	S662CD-pH Sensor, Flat, CPVC, for 2'	S662CD-pH Sensor, Flat, CPVC, for 2'		Piece	Acheté
IT-000127	TX100	TX100	TX100		Piece	Acheté
IT-000128	S660CDHF	S660CDHF	S660CDHF		Piece	Acheté
IT-000129	S653/20/BNC	S653/20/BNC	S653/20/BNC		Piece	Acheté
IT-000130	S273CD		Comb pH Electrode with Hemi-pH Glass, 10ft,BNC		Piece	Acheté
IT-000131	GT111	GT111	GT111 -replacejment of PHER-DJ-112-SE		Piece	Acheté
IT-000132	BNC-WTP-8MMCB-CRP		Waterproof BNC Male Crimp Connector		Piece	Acheté
IT-000133	S450CD	pH Sensor, Flat, 15mm, Polymer, DJ	S450CD-pH sensor, flat, 15 mm, polymer, DJ		Piece	Acheté
IT-000134	S465C-ORP-AU	ORP Gold Electrode, No Cable, BNR Quick Disconnect	S465C-ORP-AU		Piece	Acheté
IT-000135	S354CD	pH Electrode, double-junction, epoxy body, flat tip, Din 13.5mm Cap, no cable	S354CD		Piece	Acheté
IT-000136	S290C	pH/ATC Electrode, single-junction, epoxy body, 30K, 8pin DIN (Orion® A, Hach® EC)	S290C		Piece	Acheté
IT-000137	S450C/BNC	pH Electrode, single-junction, epoxy body, 15 mm dia, 115 mm L	pH Electrode, single-junction, epoxy body, 15 mm dia, 115 mm L		Piece	Acheté
IT-000138	S350CD-ORP	S350CD-ORP	Comb ORP Electrode,		Piece	Acheté
IT-000139	S350CD	S350CD	pH Electrode, double-junction, epoxy body, flat tip		Piece	Acheté
IT-000140	SSRE	SSRE	Smart Sensors Remote Electronics, pH, 4-20mA, DIN Rail		Piece	Acheté
IT-000141	SSRE-P-MA/DR		SSRE-P-MA/DR /P - pH/MA - 4-20 mA/DR - DIN Rail			Acheté
IT-000142	SSRE-O-MA/DR		SSRE-O-MA/DR  -O - ORP/MA - 4-20 mA /DR - DIN Rail		Piece	Acheté$$)
), lines2 AS (
  SELECT regexp_split_to_table(replace(tsv, E'\r', ''), E'\n') AS line
    FROM raw2
), parsed2 AS (
  SELECT
    nullif(btrim((string_to_array(line, E'\t'))[1]), '') AS item_code,
    nullif(btrim((string_to_array(line, E'\t'))[2]), '') AS reference,
    nullif(btrim((string_to_array(line, E'\t'))[3]), '') AS description,
    nullif(btrim((string_to_array(line, E'\t'))[4]), '') AS description_short,
    nullif(btrim((string_to_array(line, E'\t'))[5]), '') AS picture,
    nullif(btrim((string_to_array(line, E'\t'))[6]), '') AS unit,
    nullif(btrim((string_to_array(line, E'\t'))[7]), '') AS procurement_type
  FROM lines2
), rows2 AS (
  SELECT * FROM parsed2 OFFSET 1 -- skip header
)
UPDATE mod_bom_items i
SET name = COALESCE(r.reference, r.description_short, r.description, r.item_code),
    uom = COALESCE(r.unit, i.uom),
    code = COALESCE(r.item_code, i.code),
    reference = COALESCE(r.reference, i.reference),
    description = COALESCE(r.description, i.description),
    description_short = COALESCE(r.description_short, i.description_short),
    picture = COALESCE(r.picture, i.picture),
    unit = COALESCE(r.unit, i.unit),
    procurement_type = COALESCE(r.procurement_type, i.procurement_type),
    updated_at = NOW()
FROM rows2 r
WHERE i.org_id IS NULL AND i.sku = r.item_code;
