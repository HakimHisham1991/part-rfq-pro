using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Data;

/// <summary>
/// Loads material specifications from Data/material-specs-master.json (sourced from MASTER - MATERIAL SPEC.xlsx).
/// </summary>
public static class MaterialSpecMasterSeed
{
    public const int ExpectedCount = 171;
    private const string MarkerSpecification = "6/6, MOS2 FILLED";
    private const string SeedFileName = "material-specs-master.json";
    private const string SeedCreatedBy = "Admin";
    private const string LegacySeedCreatedBy = "MASTER - MATERIAL SPEC.xlsx";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static async Task EnsureSeededAsync(AppDbContext db)
    {
        await db.MaterialSpecs
            .Where(m => m.CreatedBy == LegacySeedCreatedBy)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.CreatedBy, SeedCreatedBy));

        var count = await db.MaterialSpecs.CountAsync();
        if (count == ExpectedCount
            && await db.MaterialSpecs.AnyAsync(m => m.Specification == MarkerSpecification))
            return;

        var items = LoadMasterItems();
        var existing = await db.MaterialSpecs.ToListAsync();
        if (existing.Count > 0)
            db.MaterialSpecs.RemoveRange(existing);

        var createdDate = new DateOnly(2026, 5, 29);
        foreach (var item in items)
        {
            db.MaterialSpecs.Add(new MaterialSpec
            {
                Specification = item.Specification,
                GeneralName = item.GeneralName,
                MaterialType = item.MaterialType,
                Density = item.Density,
                CreatedBy = SeedCreatedBy,
                CreatedDate = createdDate,
                Status = item.Status
            });
        }

        await db.SaveChangesAsync();
    }

    private static List<MaterialSpecMasterItem> LoadMasterItems()
    {
        var path = ResolveSeedPath();
        if (path == null)
            throw new FileNotFoundException(
                $"Material spec master seed file not found: {SeedFileName}");

        var json = File.ReadAllText(path);
        var items = JsonSerializer.Deserialize<List<MaterialSpecMasterItem>>(json, JsonOptions);
        if (items == null || items.Count == 0)
            throw new InvalidDataException("Material spec master seed file is empty.");

        return items;
    }

    private static string? ResolveSeedPath()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "Data", SeedFileName),
            Path.Combine(Directory.GetCurrentDirectory(), "Data", SeedFileName)
        };

        foreach (var path in candidates)
        {
            if (File.Exists(path)) return path;
        }

        return null;
    }

    private sealed class MaterialSpecMasterItem
    {
        [JsonPropertyName("specification")]
        public string Specification { get; set; } = "";

        [JsonPropertyName("generalName")]
        public string GeneralName { get; set; } = "";

        [JsonPropertyName("materialType")]
        public string MaterialType { get; set; } = "";

        [JsonPropertyName("density")]
        public double Density { get; set; }

        [JsonPropertyName("status")]
        public string Status { get; set; } = "Active";
    }
}
