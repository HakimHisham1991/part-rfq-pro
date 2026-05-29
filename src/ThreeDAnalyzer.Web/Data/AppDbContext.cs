using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Part> Parts => Set<Part>();
    public DbSet<User> Users => Set<User>();
    public DbSet<MaterialSpec> MaterialSpecs => Set<MaterialSpec>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Project>(e =>
        {
            e.HasIndex(x => x.Name);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Owner).HasMaxLength(100);
            e.Property(x => x.Status).HasMaxLength(20);
        });

        modelBuilder.Entity<Part>(e =>
        {
            e.HasIndex(x => new { x.ProjectId, x.PartNumber });
            e.HasOne(x => x.Project).WithMany(x => x.Parts).HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.PartNumber).HasMaxLength(80);
            e.Property(x => x.PartDescription).HasMaxLength(500);
            e.Property(x => x.MaterialSpec).HasMaxLength(100);
            e.Property(x => x.FirstDelivery).HasMaxLength(50);
            e.Property(x => x.Aircraft).HasMaxLength(50);
        });

        modelBuilder.Entity<User>(e =>
        {
            e.HasIndex(x => x.Username).IsUnique();
            e.Property(x => x.Username).HasMaxLength(64);
            e.Property(x => x.Password).HasMaxLength(128);
            e.Property(x => x.DisplayName).HasMaxLength(200);
            e.Property(x => x.Status).HasMaxLength(20);
        });

        modelBuilder.Entity<MaterialSpec>(e =>
        {
            e.HasIndex(x => x.Specification).IsUnique();
            e.Property(x => x.Specification).HasMaxLength(100);
            e.Property(x => x.GeneralName).HasMaxLength(200);
            e.Property(x => x.MaterialType).HasMaxLength(80);
            e.Property(x => x.CreatedBy).HasMaxLength(200);
            e.Property(x => x.Status).HasMaxLength(20);
        });
    }
}
