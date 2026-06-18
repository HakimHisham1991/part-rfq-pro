using System.Globalization;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Services;

public static class PartExportRows
{
    public static readonly string[] Headers =
    [
        "Aircraft",
        "No",
        "Part Number",
        "Part Description",
        "Picture",
        "QPA",
        "1st launch quantity",
        "1st delivery",
        "MATERIAL SPEC",
        "FINISH SIZE (MM): THICKNESS / DIAMETER",
        "FINISH SIZE (MM): WIDTH",
        "FINISH SIZE (MM): LENGTH",
        "MATERIAL (MM): RULING DIM.",
        "MATERIAL (MM): THICKNESS / DIAMETER",
        "MATERIAL (MM): WIDTH",
        "MATERIAL (MM): LENGTH",
        "QTY/BILLET",
        "SETUP TIME (HOUR)",
        "CYCLE TIME (HOUR): TurnMill",
        "CYCLE TIME (HOUR): 3X",
        "CYCLE TIME (HOUR): 4X",
        "CYCLE TIME (HOUR): 5X",
        "CYCLE TIME (HOUR): TOTAL HRS REQUIRE"
    ];

    public static string[] GetValues(Part part) =>
    [
        part.Aircraft,
        part.No.ToString(CultureInfo.InvariantCulture),
        part.PartNumber,
        part.PartDescription,
        part.Picture,
        part.Qpa.ToString(CultureInfo.InvariantCulture),
        part.FirstLaunchQty.ToString(CultureInfo.InvariantCulture),
        part.FirstDelivery,
        part.MaterialSpec,
        part.FinishThickness.ToString(CultureInfo.InvariantCulture),
        part.FinishWidth.ToString(CultureInfo.InvariantCulture),
        part.FinishLength.ToString(CultureInfo.InvariantCulture),
        part.MaterialRulingDim.ToString(CultureInfo.InvariantCulture),
        part.MaterialThickness.ToString(CultureInfo.InvariantCulture),
        part.MaterialWidth.ToString(CultureInfo.InvariantCulture),
        part.MaterialLength.ToString(CultureInfo.InvariantCulture),
        part.QtyPerBillet.ToString(CultureInfo.InvariantCulture),
        part.SetupTimeHour.ToString(CultureInfo.InvariantCulture),
        part.CycleTurnMill.ToString(CultureInfo.InvariantCulture),
        part.Cycle3x.ToString(CultureInfo.InvariantCulture),
        part.Cycle4x.ToString(CultureInfo.InvariantCulture),
        part.Cycle5x.ToString(CultureInfo.InvariantCulture),
        part.CycleTotalHrs.ToString(CultureInfo.InvariantCulture)
    ];
}
