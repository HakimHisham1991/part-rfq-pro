using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Data;

public static class OperationTemplateMasterSeed
{
    private const string SeedFileName = "operation-templates-master.json";
    private const string SeedCreatedBy = "Admin";
    private const string MarkerName = "Drill Ø10";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static async Task EnsureSeededAsync(AppDbContext db)
    {
        await EnsureTableAsync(db);

        if (await db.OperationTemplates.AnyAsync(t => t.Name == MarkerName))
            return;

        var items = LoadMasterItems();
        if (items.Count == 0) return;

        var existing = await db.OperationTemplates.ToListAsync();
        if (existing.Count > 0)
            db.OperationTemplates.RemoveRange(existing);

        var createdDate = new DateOnly(2026, 6, 10);
        foreach (var item in items)
        {
            db.OperationTemplates.Add(new OperationTemplate
            {
                Name = item.Name,
                OperationType = item.OperationType,
                ParamsJson = JsonSerializer.Serialize(item.Params ?? new Dictionary<string, double>()),
                CreatedBy = SeedCreatedBy,
                CreatedDate = createdDate,
                Status = item.Status ?? "Active"
            });
        }

        await db.SaveChangesAsync();
    }

    private static async Task EnsureTableAsync(AppDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS OperationTemplates (
                Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                OperationType TEXT NOT NULL,
                ParamsJson TEXT NOT NULL DEFAULT '{{}}',
                CreatedBy TEXT NOT NULL DEFAULT '',
                CreatedDate TEXT NOT NULL,
                Status TEXT NOT NULL DEFAULT 'Active'
            );
            """);

        await db.Database.ExecuteSqlRawAsync("""
            CREATE UNIQUE INDEX IF NOT EXISTS IX_OperationTemplates_Name
            ON OperationTemplates (Name);
            """);
    }

    private static List<OperationTemplateMasterItem> LoadMasterItems()
    {
        var path = ResolveSeedPath();
        if (!File.Exists(path)) return [];

        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<List<OperationTemplateMasterItem>>(json, JsonOptions) ?? [];
    }

    private static string ResolveSeedPath()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "Data", SeedFileName),
            Path.Combine(Directory.GetCurrentDirectory(), "Data", SeedFileName),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Data", SeedFileName)
        };

        foreach (var c in candidates)
        {
            var full = Path.GetFullPath(c);
            if (File.Exists(full)) return full;
        }

        return Path.GetFullPath(candidates[0]);
    }

    private sealed class OperationTemplateMasterItem
    {
        public string Name { get; set; } = "";
        public string OperationType { get; set; } = "";

        [JsonPropertyName("params")]
        public Dictionary<string, double>? Params { get; set; }

        public string? Status { get; set; }
    }
}
