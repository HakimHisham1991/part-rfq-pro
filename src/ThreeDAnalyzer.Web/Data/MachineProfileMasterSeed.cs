using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Data;

public static class MachineProfileMasterSeed
{
    private const string SeedFileName = "machines-master.json";
    private const string SeedCreatedBy = "Admin";
    private const string MarkerName = "Hartford Aero-426";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static async Task EnsureSeededAsync(AppDbContext db)
    {
        await EnsureTableAsync(db);

        if (await db.MachineProfiles.AnyAsync(m => m.Name == MarkerName))
            return;

        var items = LoadMasterItems();
        if (items.Count == 0) return;

        var existing = await db.MachineProfiles.ToListAsync();
        if (existing.Count > 0)
            db.MachineProfiles.RemoveRange(existing);

        var createdDate = new DateOnly(2026, 6, 11);
        foreach (var item in items)
        {
            db.MachineProfiles.Add(new MachineProfile
            {
                Name = item.Name,
                RapidRateMmpm = item.RapidRateMmpm,
                SpindlePowerKw = item.SpindlePowerKw,
                AccelDecelFactor = item.AccelDecelFactor,
                ToolChangeTimeSec = item.ToolChangeTimeSec,
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
            CREATE TABLE IF NOT EXISTS MachineProfiles (
                Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                RapidRateMmpm REAL NOT NULL DEFAULT 0,
                SpindlePowerKw REAL NOT NULL DEFAULT 0,
                AccelDecelFactor REAL NOT NULL DEFAULT 1,
                ToolChangeTimeSec REAL NOT NULL DEFAULT 0,
                CreatedBy TEXT NOT NULL DEFAULT '',
                CreatedDate TEXT NOT NULL,
                Status TEXT NOT NULL DEFAULT 'Active'
            );
            """);

        await db.Database.ExecuteSqlRawAsync("""
            CREATE UNIQUE INDEX IF NOT EXISTS IX_MachineProfiles_Name
            ON MachineProfiles (Name);
            """);
    }

    private static List<MachineProfileMasterItem> LoadMasterItems()
    {
        var path = ResolveSeedPath();
        if (!File.Exists(path)) return [];

        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<List<MachineProfileMasterItem>>(json, JsonOptions) ?? [];
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

    private sealed class MachineProfileMasterItem
    {
        public string Name { get; set; } = "";
        public double RapidRateMmpm { get; set; }
        public double SpindlePowerKw { get; set; }
        public double AccelDecelFactor { get; set; }
        public double ToolChangeTimeSec { get; set; }
        public string? Status { get; set; }
    }
}
